export interface TranscriptionResult {
	raw: string;
	processed?: string;
	language?: string;
	duration?: number;
	sourceName: string;
	timestamps?: TimestampEntry[];
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
}
