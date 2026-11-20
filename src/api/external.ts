import { generateId, JobCallRefusedError } from '../shared';
import type { AIRequestOptions, ExternalAIReply, ExternalGenerator } from '../shared';
import type { ApiBilling, ApiGenerationOutput, ApiGenerationRequest, ApiJobUsage } from './types';

/** An external request nobody answers within this time fails, so a stalled caller never holds a note's queue slot for good. */
export const EXTERNAL_REPLY_TIMEOUT_MS = 30 * 60 * 1000;

interface PendingRequest {
	request: ApiGenerationRequest;
	resolve: (reply: ExternalAIReply) => void;
	reject: (error: Error) => void;
	timer: number;
}

/**
 * The model requests of one external-billing job (#626). Each request the feature's code makes
 * waits here until `commit` supplies its output, it times out, or the job is cancelled.
 */
export class ExternalRequests {
	private pending = new Map<string, PendingRequest>();
	private listeners = new Set<() => void>();
	private closedReason: string | null = null;

	constructor(private now: () => number = () => Date.now(), private timeoutMs = EXTERNAL_REPLY_TIMEOUT_MS) {}

	readonly generate: ExternalGenerator = (request) => new Promise<ExternalAIReply>((resolve, reject) => {
		if (this.closedReason !== null) {
			reject(new JobCallRefusedError(this.closedReason));
			return;
		}
		const id = `req${generateId()}`;
		const createdAt = this.now();
		const timer = window.setTimeout(() => {
			this.reject(id, new JobCallRefusedError(`No output arrived for request ${id} within ${Math.round(this.timeoutMs / 60000)} minutes`));
		}, this.timeoutMs);
		this.pending.set(id, {
			request: {
				id,
				feature: request.feature,
				messages: request.messages,
				createdAt: new Date(createdAt).toISOString(),
				expiresAt: new Date(createdAt + this.timeoutMs).toISOString(),
			},
			resolve,
			reject,
			timer,
		});
		this.changed();
	});

	list(): ApiGenerationRequest[] {
		return [...this.pending.values()].map((entry) => entry.request);
	}

	/** Answer pending requests. Every output is checked first; on an error none is applied and the reason is returned. */
	commit(outputs: ApiGenerationOutput[]): string | null {
		if (this.closedReason !== null) return this.closedReason;
		if (outputs.length === 0) return 'No outputs given';
		const seen = new Set<string>();
		for (const output of outputs) {
			if (!this.pending.has(output.requestId)) return `No pending request with id ${output.requestId}`;
			if (seen.has(output.requestId)) return `Request ${output.requestId} is answered twice`;
			seen.add(output.requestId);
		}
		for (const { requestId, ...reply } of outputs) {
			const entry = this.pending.get(requestId);
			if (!entry) continue;
			this.pending.delete(requestId);
			window.clearTimeout(entry.timer);
			entry.resolve(reply);
		}
		this.changed();
		return null;
	}

	/** Fail every pending request and refuse new ones. */
	close(reason: string): void {
		if (this.closedReason !== null) return;
		this.closedReason = reason;
		for (const id of [...this.pending.keys()]) this.reject(id, new JobCallRefusedError(reason));
	}

	/** Resolves once a request is pending (at once when one already is); `dispose` drops the listener. */
	whenAwaiting(): { promise: Promise<void>; dispose: () => void } {
		let listener: (() => void) | undefined;
		const promise = new Promise<void>((resolve) => {
			if (this.pending.size > 0) {
				resolve();
				return;
			}
			listener = () => {
				if (this.pending.size > 0) resolve();
			};
			this.listeners.add(listener);
		});
		return { promise, dispose: () => { if (listener) this.listeners.delete(listener); } };
	}

	private reject(id: string, error: Error): void {
		const entry = this.pending.get(id);
		if (!entry) return;
		this.pending.delete(id);
		window.clearTimeout(entry.timer);
		entry.reject(error);
		this.changed();
	}

	private changed(): void {
		for (const listener of [...this.listeners]) listener();
	}
}

/** One generating job's billing, call cap and usage total (#626); its `aiOptions` join every model call the job makes. */
export class JobGeneration {
	readonly external: ExternalRequests | null;
	private calls = 0;
	private inputTokens = 0;
	private outputTokens = 0;

	constructor(readonly billing: ApiBilling, readonly maxCalls: number | null, now?: () => number) {
		this.external = billing === 'external' ? new ExternalRequests(now) : null;
	}

	aiOptions(): AIRequestOptions {
		const opts: AIRequestOptions = {
			beforeCall: () => {
				if (this.maxCalls !== null && this.calls >= this.maxCalls) {
					throw new JobCallRefusedError(`This job reached its limit of ${this.maxCalls} model ${this.maxCalls === 1 ? 'call' : 'calls'}`);
				}
				this.calls++;
			},
			onResponse: (info) => {
				if (info.cached || info.joined) return;
				this.inputTokens += info.usage?.inputTokens ?? 0;
				this.outputTokens += info.usage?.outputTokens ?? 0;
			},
		};
		if (this.external) opts.external = this.external.generate;
		return opts;
	}

	usage(): ApiJobUsage {
		return {
			billing: this.billing,
			calls: this.calls,
			maxCalls: this.maxCalls,
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
		};
	}
}
