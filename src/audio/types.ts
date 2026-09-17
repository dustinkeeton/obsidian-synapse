import { TFile } from 'obsidian';
import { TimeRange } from '../shared';

export interface TranscriptionResult {
	raw: string;
	processed?: string;
	language?: string;
	duration?: number;
	sourceName: string;
	timestamps?: TimestampEntry[];
	/** True when a content schema (#234, e.g. lyrics) reformatted the transcript. */
	reformatted?: boolean;
	/** Id of the content schema that reformatted the transcript, if any (e.g. 'lyrics'). */
	schemaId?: string;
	/** True when any AI pass (post-processing, schema reformat) replayed a cached response (#527). */
	aiCached?: boolean;
}

export interface TimestampEntry {
	start: number;
	end: number;
	text: string;
}

export interface TranscribeOptions {
	language?: string;
	postProcess?: boolean;
	sourceName?: string;
	timeRange?: TimeRange;
	/** Progress sink for long post-processing runs (e.g. an operation toast's update). */
	update?: (message: string) => void;
	/** Dispatch every AI pass on this transcript fresh instead of replaying a cached response (#527). */
	bypassCache?: boolean;
}

export interface AudioEmbed {
	fileName: string;
	file: TFile;
	line: number;
}
