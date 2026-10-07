/** Transcript handed to summarize by the injected transcribers; structurally matches the router result. */
export interface TranscribedMedia {
	/** Video title / poster frame when the tier exposes them (#213, source images). */
	title?: string;
	thumbnailUrl?: string;
	text: string;
	/** Served from the transcript store (#488). */
	cached?: boolean;
	/** AI post-processing replayed a cached response (#527). */
	aiCached?: boolean;
	/** Vault path of a media file the transcription downloaded (local extraction only). */
	videoVaultPath?: string;
}

export interface SummarizeTarget {
	type: 'url' | 'transcription' | 'audio' | 'note-content';
	source: string;        // URL / transcription source label, or note basename for note-content
	line: number;          // line number in note (last line for note-content, so its callout appends)
	endLine: number;       // end of target block (for transcriptions / note-content)
	content?: string;      // pre-extracted content (transcriptions and note-content prose)
	inEnrichmentSection?: boolean;  // found inside enrichment markers
	linkTitle?: string;    // display text from markdown link (enrichment refs)
}
