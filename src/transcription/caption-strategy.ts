import { redactError } from '../shared';
import { detectPlatform } from '../shared';
import type { SynapseSettings } from '../settings';
import { fetchYouTubeTranscript } from './youtube-captions';
import type { UrlTranscript, UrlTranscriptOptions, UrlTranscriptionStrategy } from './url-transcription';

/**
 * Result of running a transcript string through the audio module's
 * post-processing pipeline (cleanup + optional schema reformat, #234).
 * Matches the return shape of `AudioModule.processTranscriptText`.
 */
export interface ProcessedTranscript {
	text: string;
	reformatted?: boolean;
	schemaId?: string;
}

export type ProcessTranscript = (raw: string) => Promise<ProcessedTranscript>;

/**
 * Tier 1 of URL transcription (#184): YouTube captions over HTTP. Free, fast,
 * dependency-less, and the only tier available on mobile in Phase 1.
 *
 * The fetched caption text runs through the SAME post-processing pipeline as
 * audio transcriptions (injected as a callback to keep this module decoupled
 * from AudioModule), so ASR captions gain punctuation/structure and song
 * lyrics get the lyrics-schema callout. A post-processing failure (e.g. no AI
 * key configured) degrades to the raw caption text rather than failing the
 * transcription — the captions themselves are already useful.
 */
export class CaptionStrategy implements UrlTranscriptionStrategy {
	readonly id = 'captions';

	constructor(
		private readonly getSettings: () => SynapseSettings,
		private readonly postProcess: ProcessTranscript
	) {}

	canHandle(url: string, opts: UrlTranscriptOptions): boolean {
		// Captions carry no per-second audio, so a clip range forces extraction.
		if (opts.timeRange) return false;
		if (!this.getSettings().video.captionsFirst) return false;
		return detectPlatform(url)?.platform === 'youtube';
	}

	async transcribe(url: string, opts: UrlTranscriptOptions): Promise<UrlTranscript | null> {
		opts.update?.('Fetching YouTube captions...');
		const preferred = [this.getSettings().audio.language, 'en'].filter(
			(lang) => lang.trim().length > 0
		);
		const captions = await fetchYouTubeTranscript(url, preferred);
		if (!captions) {
			return null;
		}

		// Deterministically structured transcripts (speaker turns / chapter
		// headings) are finished markdown — an AI rewrite would only flatten
		// the structure the caption stream itself declared. Only weakly
		// structured (plain ASR) text goes through the post-processing pass.
		if (captions.structured) {
			return {
				text: captions.text,
				raw: captions.text,
				source: 'captions',
				title: captions.title,
				language: captions.language,
			};
		}

		opts.update?.('Post-processing transcript...');
		let processed: ProcessedTranscript = { text: captions.text };
		try {
			processed = await this.postProcess(captions.text);
		} catch (error) {
			console.warn(
				'[Synapse] Caption post-processing failed; keeping raw captions',
				redactError(error)
			);
		}

		return {
			text: processed.text || captions.text,
			raw: captions.text,
			source: 'captions',
			title: captions.title,
			language: captions.language,
			reformatted: processed.reformatted,
			schemaId: processed.schemaId,
		};
	}
}
