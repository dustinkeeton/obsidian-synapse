import { App } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AIClient, sanitizeAIResponse, stripCodeFences, isTwitterUrl, fetchTweetContent, fetchArticleContent } from '../shared';
import { ImageAnalyzer, ImageAnalysis } from './image-analyzer';
import { DetectionResult, Proposal } from './types';

export class ProposalGenerator {
	private aiClient: AIClient;
	private imageAnalyzer: ImageAnalyzer;

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {
		this.aiClient = new AIClient(getSettings);
		this.imageAnalyzer = new ImageAnalyzer(app, getSettings);
	}

	async generate(detection: DetectionResult): Promise<Proposal> {
		const content = await this.app.vault.adapter.read(detection.notePath);
		const settings = this.getSettings();

		let contextNotes = '';
		if (settings.elaboration.proposal.includeSourceContext) {
			contextNotes = await this.gatherContext(detection.notePath);
		}

		// Gather image context if image module is enabled
		let imageContext = '';
		let analyses: ImageAnalysis[] = [];
		if (settings.image.enabled) {
			const result = await this.gatherImageContext(detection.notePath, content);
			imageContext = result.context;
			analyses = result.analyses;
		}

		// Gather external context from Twitter URLs in the note
		const externalContext = await this.gatherExternalContext(content);

		const prompt = this.buildPrompt(content, detection, contextNotes, imageContext, externalContext);
		const systemPrompt = imageContext
			? 'You are a note-taking assistant. Your job is to expand placeholder or stub notes into fuller, more useful content. Preserve the original voice and intent. Output only the proposed additions in markdown format. Do not wrap the output in code fences. Image analysis has been provided -- use the descriptions to write contextually aware content that references what the images actually show. Preserve all image embeds in their original format.'
			: 'You are a note-taking assistant. Your job is to expand placeholder or stub notes into fuller, more useful content. Preserve the original voice and intent. Output only the proposed additions in markdown format. Do not wrap the output in code fences. If the source content contains image URLs, preserve them as markdown image embeds (![alt](url)) rather than describing the image in text. For internal images referenced as [[image.jpg]], embed them as ![[image.jpg]].';

		const rawAdditions = await this.aiClient.complete(prompt, systemPrompt);
		const proposedAdditions = stripCodeFences(sanitizeAIResponse(rawAdditions));

		return {
			id: this.generateId(),
			sourceNotePath: detection.notePath,
			createdAt: new Date().toISOString(),
			detectionReasons: detection.reasons,
			originalContent: content,
			proposedAdditions,
			insertionPoint: 'append',
			status: 'pending',
			imageAnalysis: analyses.length > 0 ? analyses : undefined,
		};
	}

	private buildPrompt(
		content: string,
		detection: DetectionResult,
		contextNotes: string,
		imageContext: string,
		externalContext = ''
	): string {
		const reasonDescriptions = detection.reasons.map(r => {
			switch (r.type) {
				case 'short-note':
					return `Short note (${r.wordCount} words)`;
				case 'todo-marker':
					return `Contains TODO markers: ${r.markers.join(', ')}`;
				case 'empty-section':
					return `Empty section: "${r.heading}"`;
				case 'sparse-link':
					return `Linked from ${r.linkedFrom.length} notes but has sparse content`;
				case 'user-requested':
					return 'User explicitly requested elaboration on this note';
			}
		});

		const isUserRequested = detection.reasons.length === 1
			&& detection.reasons[0].type === 'user-requested';

		let prompt: string;
		if (isUserRequested) {
			prompt = `The user has requested elaboration suggestions for the following note:\n\n---\n${content}\n---\n\nPlease review the entire note and propose additions, expansions, or improvements that would make it more comprehensive and useful. Consider adding detail to existing sections, suggesting new sections, or expanding on key ideas.`;
		} else {
			prompt = `The following note appears to be a placeholder or stub:\n\n---\n${content}\n---\n\nReasons it was flagged:\n${reasonDescriptions.map(r => `- ${r}`).join('\n')}\n\nPlease propose additions that would flesh out this note.`;
		}

		if (contextNotes) {
			prompt += `\n\nContext from related notes:\n${contextNotes}`;
		}

		if (imageContext) {
			prompt += `\n\nImage analysis from this note:\n${imageContext}`;
		}

		if (externalContext) {
			prompt += `\n\nExternal content referenced in this note:\n${externalContext}`;
		}

		return prompt;
	}

	private async gatherExternalContext(content: string): Promise<string> {
		const urlRegex = /https?:\/\/[^\s)\]>]+/g;
		const urls = [...content.matchAll(urlRegex)]
			.map(m => m[0])
			// Twitter URLs are fetched as tweets; everything else that isn't a
			// known video host is treated as an article. Video hosts are skipped
			// because their pages are JS-rendered and yield no useful text --
			// proper URL classification is issue #109's job.
			.filter(u => isTwitterUrl(u) || !isVideoHost(u))
			.slice(0, 3);

		if (urls.length === 0) return '';

		const parts: string[] = [];
		for (const url of urls) {
			try {
				const text = isTwitterUrl(url)
					? await fetchTweetContent(url, 500)
					: await fetchArticleContent(url, 2000);
				if (text.trim()) parts.push(text);
			} catch {
				// Non-fatal — skip URLs that can't be fetched
			}
		}
		return parts.join('\n\n---\n\n');
	}

	private async gatherContext(notePath: string): Promise<string> {
		const cache = this.app.metadataCache.getCache(notePath);
		if (!cache?.links) return '';

		const contextParts: string[] = [];
		for (const link of cache.links.slice(0, 5)) {
			const resolved = this.app.metadataCache.getFirstLinkpathDest(
				link.link,
				notePath
			);
			if (resolved) {
				const content = await this.app.vault.read(resolved);
				contextParts.push(
					`### ${resolved.basename}\n${content.slice(0, 500)}`
				);
			}
		}
		return contextParts.join('\n\n');
	}

	private async gatherImageContext(
		notePath: string,
		content: string
	): Promise<{ context: string; analyses: ImageAnalysis[] }> {
		try {
			const analyses = await this.imageAnalyzer.analyzeImagesInNote(notePath, content);
			if (analyses.length === 0) return { context: '', analyses: [] };

			const parts = analyses.map(a => {
				let section = `**Image: ${a.reference}**\n- Description: ${a.description}`;
				if (a.locationHints && a.locationHints !== 'No location clues detected.') {
					section += `\n- Location: ${a.locationHints}`;
				}
				if (a.metadata && a.metadata !== 'No metadata observations.') {
					section += `\n- Metadata: ${a.metadata}`;
				}
				return section;
			});
			return { context: parts.join('\n\n'), analyses };
		} catch (error) {
			console.warn('[Synapse] Failed to gather image context:', error);
			return { context: '', analyses: [] };
		}
	}

	private generateId(): string {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
			/[xy]/g,
			(c) => {
				const r = (Math.random() * 16) | 0;
				const v = c === 'x' ? r : (r & 0x3) | 0x8;
				return v.toString(16);
			}
		);
	}
}

/**
 * Hosts whose pages are JS-rendered video and yield no useful article text.
 * Intentionally a tiny local list rather than importing video/url-detector,
 * to avoid an elaboration -> video module coupling. Proper URL classification
 * is tracked in issue #109; this is just a conservative skip guard.
 */
const VIDEO_HOST_PATTERN =
	/(?:^|\.)(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|vimeo\.com)$/i;

function isVideoHost(url: string): boolean {
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		return false;
	}
	return VIDEO_HOST_PATTERN.test(host);
}
