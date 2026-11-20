/** The parts of the plugin's public API shapes (`src/api/types.ts`) the shim reads. */

export interface ParamSpec {
	name: string;
	description: string;
	required: boolean;
	schema: Record<string, unknown>;
}

export interface VerbSpec {
	name: string;
	description: string;
	params: ParamSpec[];
	result?: Record<string, unknown>;
	long: boolean;
	available: boolean;
}

export interface Capabilities {
	apiVersion: number;
	pluginVersion: string;
	verbs: VerbSpec[];
}

export type JobStatus = 'running' | 'awaiting-output' | 'completed' | 'failed' | 'cancelled';

export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mediaType: string };

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string | ContentBlock[];
}

export interface GenerationRequest {
	id: string;
	feature: string | null;
	messages: ChatMessage[];
	expiresAt?: string;
}

export interface Job {
	id: string;
	verb: string;
	status: JobStatus;
	progress: { message: string; current?: number; total?: number } | null;
	requests?: GenerationRequest[];
	[key: string]: unknown;
}

export interface JobWait {
	ok: boolean;
	timedOut: boolean;
	job: Job | null;
	error?: string;
	[key: string]: unknown;
}

export interface GenerationOutput {
	requestId: string;
	text: string;
	model?: string;
	stopReason?: string;
	truncated?: boolean;
	usage?: { inputTokens?: number; outputTokens?: number };
}
