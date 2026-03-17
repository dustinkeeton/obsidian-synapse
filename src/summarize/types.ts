export interface SummarizeTarget {
	type: 'url' | 'transcription' | 'audio';
	source: string;        // URL or transcription source label
	line: number;          // line number in note
	endLine: number;       // end of target block (for transcriptions)
	content?: string;      // pre-extracted content (for transcriptions)
	inEnrichmentSection?: boolean;  // found inside enrichment markers
	linkTitle?: string;    // display text from markdown link (enrichment refs)
}
