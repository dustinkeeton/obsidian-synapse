import type { App, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import type { RemLinkCandidate, RemOccurrence } from './types';
import { AIClient, DecisionClient, MAX_CHOICE_OPTIONS, choice, isRecord, parseJson, getIncludedMarkdownFiles, redactError, score } from '../shared';
import type { ChoiceQuestion, DecisionRequestOptions, ScoreAnswer, ScoreQuestion } from '../shared';

/** One conceptual match the AI is expected to return, after validation. */
interface SemanticMatch {
	title: string;
	matchedConcept: string;
	confidence: number;
}

interface NoteTitle {
	path: string;
	title: string;
	folder: string;
}

/** A sentence of the note offered to the lane as a link anchor. */
export interface AnchorSentence extends RemOccurrence {
	text: string;
}

/** Ordered rubric for the System 1 relevance score; only the last level counts toward relevance. */
export const RELEVANCE_LEVELS = [
	'Unrelated: the text and the note share no subject',
	'Tangential: the text names the note\'s subject or a neighbouring topic only in passing',
	'Related: the text and the note share a broader field, but the text discusses a different subject',
	'Strongly related: the text discusses the note\'s own subject, so a reader would want the link',
];
const STRONGLY_RELATED_LEVEL = String(RELEVANCE_LEVELS.length - 1);
const CONTENT_MAX_CHARS = 4000;
export const NO_ANCHOR = '<none>';
const MIN_ANCHOR_CHARS = 3;
// Brackets, pipes, and backticks would break the inserted [[target|anchor]] alias.
const UNSAFE_ANCHOR = /[[\]|`]/;
const WIKILINK = /\[\[([^\]|#^]+)/g;

/** 0-1 relevance from a score distribution: the probability the title is strongly related. */
export function relevanceFromScore(answer: ScoreAnswer): number {
	return answer.probabilities[STRONGLY_RELATED_LEVEL] ?? 0;
}

/** The lane failed for this note; with the lane on, the caller skips the note instead of running the generative path. */
export class RemLaneError extends Error {
	constructor(cause: unknown) {
		super(`System 1 lane failed: ${redactError(cause)}`);
		this.name = 'RemLaneError';
	}
}

/** Sentences of `content` usable as link anchors, outside frontmatter and code fences, deduplicated, capped at `limit`. */
export function anchorSentences(content: string, limit = MAX_CHOICE_OPTIONS - 1): AnchorSentence[] {
	const lines = content.split('\n');
	const sentences: AnchorSentence[] = [];
	const seen = new Set<string>();
	let start = 0;
	if (lines[0]?.trim() === '---') {
		const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
		if (close > 0) start = close + 1;
	}
	let inFence = false;
	for (let lineNumber = start; lineNumber < lines.length; lineNumber++) {
		const lineText = lines[lineNumber];
		if (/^\s*(```|~~~)/.test(lineText)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const prefix = /^\s*(?:(?:#{1,6}|[-*+]|\d+[.)]|>)\s+(?:\[.\]\s+)?)*/.exec(lineText)?.[0].length ?? 0;
		const sentencePattern = /[^.!?]+[.!?]*/g;
		const body = lineText.slice(prefix);
		let match: RegExpExecArray | null;
		while ((match = sentencePattern.exec(body)) !== null) {
			const text = match[0].trim();
			if (text.length < MIN_ANCHOR_CHARS || UNSAFE_ANCHOR.test(text) || seen.has(text)) continue;
			seen.add(text);
			const startOffset = prefix + match.index + match[0].indexOf(text);
			sentences.push({ text, lineNumber, lineText, startOffset, endOffset: startOffset + text.length });
			if (sentences.length >= limit) return sentences;
		}
	}
	return sentences;
}

/** Type guard: narrows an unknown array element to a {@link SemanticMatch}. */
function isSemanticMatch(v: unknown): v is SemanticMatch {
	return (
		isRecord(v) &&
		typeof v.title === 'string' &&
		typeof v.matchedConcept === 'string' &&
		typeof v.confidence === 'number'
	);
}

/**
 * Discovers conceptual matches between a note's content and other vault note
 * titles, beyond literal text matching. With the System 1 lane on it runs
 * entirely on the lane; otherwise one generative prompt.
 */
export class SemanticMatcher {
	private aiClient: AIClient;
	private decisionClient: DecisionClient;

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {
		this.aiClient = new AIClient(getSettings);
		this.decisionClient = new DecisionClient(getSettings);
	}

	/**
	 * Find conceptual matches between a note's content and vault note titles.
	 *
	 * @param existingMatches - Target paths already matched literally
	 * @returns Anchored semantic candidates, confidence descending
	 * @throws RemLaneError when the lane is on and fails for this note
	 */
	async match(
		sourceFile: TFile,
		content: string,
		existingMatches: Set<string>,
		maxLinks: number,
		aiOpts?: DecisionRequestOptions
	): Promise<RemLinkCandidate[]> {
		const linked = this.linkedTargets(sourceFile, content);
		const allTitles: NoteTitle[] = [];
		for (const file of getIncludedMarkdownFiles(this.app, 'rem', this.getSettings())) {
			if (file.path === sourceFile.path) continue;
			if (existingMatches.has(file.path)) continue;
			if (linked.paths.has(file.path) || linked.names.has(file.basename.toLowerCase()) || linked.names.has(file.path.replace(/\.md$/, '').toLowerCase())) continue;
			allTitles.push({ path: file.path, title: file.basename, folder: file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '' });
		}

		if (allTitles.length === 0) return [];

		const truncatedContent = content.slice(0, CONTENT_MAX_CHARS);
		if (this.decisionClient.isEnabled()) {
			return this.matchOnLane(truncatedContent, allTitles, maxLinks, aiOpts);
		}
		return this.matchGenerative(content, truncatedContent, allTitles, maxLinks, aiOpts);
	}

	/** Lane-only REM: `score` per title for relevance, then one `choice` per survivor over the note's sentences for the anchor. */
	private async matchOnLane(
		content: string,
		titles: NoteTitle[],
		maxLinks: number,
		aiOpts?: DecisionRequestOptions
	): Promise<RemLinkCandidate[]> {
		const threshold = this.getSettings().rem.confidenceThreshold;
		const sentences = anchorSentences(content);
		if (sentences.length === 0) return [];

		let relevance: Map<string, number>;
		try {
			relevance = await this.scoreTitles(content, titles, aiOpts);
		} catch (error) {
			throw new RemLaneError(error);
		}
		const survivors = titles
			.filter(n => (relevance.get(n.path) ?? 0) >= threshold)
			.sort((a, b) => (relevance.get(b.path) ?? 0) - (relevance.get(a.path) ?? 0))
			.slice(0, maxLinks);
		if (survivors.length === 0) {
			aiOpts?.onSystemOne?.();
			return [];
		}

		let anchors: Map<string, AnchorSentence>;
		try {
			anchors = await this.locateAnchors(content, survivors, sentences, aiOpts);
		} catch (error) {
			throw new RemLaneError(error);
		}
		aiOpts?.onSystemOne?.();

		const candidates: RemLinkCandidate[] = [];
		for (const target of survivors) {
			const anchor = anchors.get(target.path);
			if (!anchor) continue;
			const { text, ...occurrence } = anchor;
			candidates.push({
				targetPath: target.path,
				targetDisplayName: target.title,
				matchedText: text,
				matchType: 'semantic',
				occurrences: [occurrence],
				confidence: relevance.get(target.path) ?? 0,
				lane: 'system-one',
			});
		}
		return candidates;
	}

	private async matchGenerative(
		content: string,
		truncatedContent: string,
		noteTitles: NoteTitle[],
		maxLinks: number,
		aiOpts?: DecisionRequestOptions
	): Promise<RemLinkCandidate[]> {
		const threshold = this.getSettings().rem.confidenceThreshold;
		const titleList = noteTitles.map(n => n.title).join('\n');

		const systemPrompt =
			'You are a knowledge graph assistant. Given a note\'s content and a list of ' +
			'other note titles in the vault, identify which titles are conceptually related ' +
			'to topics discussed in the note content. Only suggest strong conceptual matches, ' +
			'not tangential ones.';

		const userPrompt =
			`Note content:\n---\n${truncatedContent}\n---\n\n` +
			`Vault note titles:\n${titleList}\n\n` +
			'Respond with a JSON array of objects, each with:\n' +
			'- "title": the exact note title from the list\n' +
			'- "matchedConcept": the phrase or concept in the note content that relates to this title\n' +
			'- "confidence": a number 0-1 indicating how strong the conceptual match is\n\n' +
			'Only include matches with confidence >= 0.5. Return an empty array if no strong matches exist.\n' +
			'Respond ONLY with the JSON array, no other text.';

		let rawResponse: string;
		try {
			rawResponse = await this.aiClient.complete(userPrompt, systemPrompt, aiOpts);
		} catch (error) {
			console.warn('[Synapse REM] Semantic matching failed:', redactError(error));
			return [];
		}

		let parsed: SemanticMatch[];
		try {
			const cleaned = rawResponse.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
			const raw = parseJson(cleaned);
			if (!Array.isArray(raw)) return [];
			parsed = raw.filter(isSemanticMatch);
		} catch {
			console.warn('[Synapse REM] Failed to parse semantic match response');
			return [];
		}

		const candidates: RemLinkCandidate[] = [];
		const lines = content.split('\n');

		for (const item of parsed) {
			const target = noteTitles.find(n => n.title === item.title);
			if (!target) continue;
			if (item.confidence < threshold) continue;

			const occurrences = this.findConcept(item.matchedConcept, lines);
			if (occurrences.length === 0) continue;

			candidates.push({
				targetPath: target.path,
				targetDisplayName: target.title,
				matchedText: item.matchedConcept,
				matchType: 'semantic',
				occurrences,
				confidence: item.confidence,
				lane: 'system-two',
			});
		}

		candidates.sort((a, b) => b.confidence - a.confidence);
		return candidates.slice(0, maxLinks);
	}

	/** One `score` per title over {@link RELEVANCE_LEVELS}, keyed by path. */
	private async scoreTitles(
		content: string,
		noteTitles: NoteTitle[],
		aiOpts?: DecisionRequestOptions
	): Promise<Map<string, number>> {
		const questions: Record<string, ScoreQuestion> = {};
		noteTitles.forEach((note, index) => {
			questions[`t${index}`] = score(
				`How related is the note titled "${note.title}" (folder: ${note.folder ? `"${note.folder}"` : 'vault root'}) to the subject the text discusses?`,
				RELEVANCE_LEVELS
			);
		});
		const { answers } = await this.decisionClient.decide(content, questions, aiOpts);
		const relevance = new Map<string, number>();
		noteTitles.forEach((note, index) => {
			relevance.set(note.path, relevanceFromScore(answers[`t${index}`]));
		});
		return relevance;
	}

	/** One `choice` per title over `sentences` plus {@link NO_ANCHOR}; titles answered `<none>` are absent from the result. */
	private async locateAnchors(
		content: string,
		titles: NoteTitle[],
		sentences: AnchorSentence[],
		aiOpts?: DecisionRequestOptions
	): Promise<Map<string, AnchorSentence>> {
		const criteria: Record<string, string | null> = {};
		sentences.forEach((s, i) => { criteria[`s${i}`] = s.text; });
		criteria[NO_ANCHOR] = 'No sentence of the text discusses this note\'s subject';
		const questions: Record<string, ChoiceQuestion> = {};
		titles.forEach((note, index) => {
			questions[`a${index}`] = choice(
				`Which sentence of the text discusses the subject of the note titled "${note.title}"?`,
				criteria
			);
		});
		const { answers } = await this.decisionClient.decide(content, questions, aiOpts);
		const anchors = new Map<string, AnchorSentence>();
		titles.forEach((note, index) => {
			const picked = /^s(\d+)$/.exec(answers[`a${index}`].choice);
			const sentence = picked ? sentences[Number(picked[1])] : undefined;
			if (sentence) anchors.set(note.path, sentence);
		});
		return anchors;
	}

	/** Paths and lowercased link texts of every wikilink already in the note. */
	private linkedTargets(sourceFile: TFile, content: string): { paths: Set<string>; names: Set<string> } {
		const paths = new Set<string>();
		const names = new Set<string>();
		for (const m of content.matchAll(WIKILINK)) {
			const linkpath = m[1].trim();
			if (!linkpath) continue;
			names.add(linkpath.replace(/\.md$/, '').toLowerCase());
			const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourceFile.path);
			if (dest) paths.add(dest.path);
		}
		return { paths, names };
	}

	/** Case-insensitive occurrences of a concept phrase in the note lines. */
	private findConcept(concept: string, lines: string[]): RemOccurrence[] {
		const occurrences: RemOccurrence[] = [];
		const conceptLower = concept.toLowerCase();
		if (conceptLower.length === 0) return occurrences;

		for (let i = 0; i < lines.length; i++) {
			const lineLower = lines[i].toLowerCase();
			let searchFrom = 0;

			while (searchFrom <= lineLower.length - conceptLower.length) {
				const idx = lineLower.indexOf(conceptLower, searchFrom);
				if (idx === -1) break;

				occurrences.push({
					lineNumber: i,
					lineText: lines[i],
					startOffset: idx,
					endOffset: idx + conceptLower.length,
				});

				searchFrom = idx + conceptLower.length;
			}
		}

		return occurrences;
	}
}
