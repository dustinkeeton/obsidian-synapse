export interface SummarizeTarget {
	type: 'url' | 'transcription' | 'audio' | 'note-content';
	source: string;        // URL / transcription source label, or note basename for note-content
	line: number;          // line number in note (last line for note-content, so its callout appends)
	endLine: number;       // end of target block (for transcriptions / note-content)
	content?: string;      // pre-extracted content (transcriptions and note-content prose)
	inEnrichmentSection?: boolean;  // found inside enrichment markers
	linkTitle?: string;    // display text from markdown link (enrichment refs)
}
