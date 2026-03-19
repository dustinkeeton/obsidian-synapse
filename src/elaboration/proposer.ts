import { App } from 'obsidian';
import { SynapseSettings } from '../settings';
import { AIClient, sanitizeAIResponse, stripCodeFences } from '../shared';
import { DetectionResult, Proposal } from './types';

export class ProposalGenerator {
	private aiClient: AIClient;

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {
		this.aiClient = new AIClient(getSettings);
	}

	async generate(detection: DetectionResult): Promise<Proposal> {
		const content = await this.app.vault.adapter.read(detection.notePath);
		const settings = this.getSettings().elaboration;

		let contextNotes = '';
		if (settings.proposal.includeSourceContext) {
			contextNotes = await this.gatherContext(detection.notePath);
		}

		const prompt = this.buildPrompt(content, detection, contextNotes);
		const systemPrompt = `You are a note-taking assistant. Your job is to expand placeholder or stub notes into fuller, more useful content. Preserve the original voice and intent. Output only the proposed additions in markdown format. Do not wrap the output in code fences.`;

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
		};
	}

	private buildPrompt(
		content: string,
		detection: DetectionResult,
		contextNotes: string
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

		return prompt;
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
