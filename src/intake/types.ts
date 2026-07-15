import type { TFile } from 'obsidian';

/**
 * Frontmatter flag stamped onto a note once the intake monitor has finished
 * processing it. Presence of this key (truthy) makes processing idempotent:
 * the monitor skips any note already marked, which also prevents the
 * `modify` echo from our own flag-stamp write from reprocessing the note.
 */
export const SYNAPSE_PROCESSED_FLAG = 'synapse-processed';

/** Companion frontmatter key holding the ISO timestamp of processing. */
export const SYNAPSE_PROCESSED_AT_FLAG = 'synapse-processed-at';

/**
 * The routing decision the dispatcher makes for an intake note, as a
 * discriminated union. The `kind` discriminant tells the processor which
 * branch to execute; each variant carries exactly the data that branch needs.
 */
export type IntakeRoute =
	/**
	 * The note is essentially a single video/audio URL. Carries the URL and
	 * which media type it is so the transcription branch (#112/#184) can route
	 * it — see IntakeDeps.transcribeUrlToNote.
	 */
	| { kind: 'transcription'; url: string; mediaType: 'video' | 'audio' }
	/**
	 * The note is essentially a single article URL. Carries the URL so the
	 * processor can fetch readable content, append it, then elaborate.
	 */
	| { kind: 'article'; url: string }
	/**
	 * Everything else: prose, multiple URLs, a placeholder, plain text, or a
	 * single URL that classified as `unknown`. Runs the whole pipeline on the
	 * note as-is.
	 */
	| { kind: 'general' };

/**
 * Cross-module callbacks injected into the IntakeModule by main.ts.
 *
 * The intake module must not import other feature modules (architecture
 * rule), so every action that touches elaboration / the pipeline / future
 * transcription is reached through this bundle, wired up in main.ts exactly
 * like the enrichment/organize callback bundles.
 */
export interface IntakeDeps {
	/**
	 * Run the whole Synapse pipeline (elaboration → … → organize) against ONE
	 * note. Used by both the general and article branches; organize, its last
	 * phase, relocates the note to its proper folder (#223). Elaboration runs as
	 * pipeline phase 1, so there is no separate elaborate-only callback anymore.
	 */
	fireOnFile(file: TFile): Promise<void>;
	/**
	 * Transcription branch (#112/#184): transcribe a bare media URL through the
	 * tiered URL-transcription router and append the transcript to the note.
	 * MUST throw when transcription fails or no tier can handle the URL (e.g.
	 * TikTok on mobile), so the note stays un-stamped and a synced desktop
	 * vault's watcher can retry it.
	 */
	transcribeUrlToNote(
		url: string,
		mediaType: 'video' | 'audio',
		file: TFile,
	): Promise<void>;
}
