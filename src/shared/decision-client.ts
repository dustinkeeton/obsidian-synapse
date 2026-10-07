import type { SynapseSettings } from '../settings';
import type { AIRequestOptions } from './ai-client';
import { ApiRequestError, safeRequest } from './safe-request';
import { withRetry } from './api-utils';
import { isRecord } from './json-utils';
import { contentKey } from './hash-utils';
import { redactSecrets } from './redact';

export const SYSTEM_ONE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

/** Documented Jev limits (docs.typesafe.ai/models, 2026-10-06), applied at 80% as a chars/4 estimate. */
const MAX_REQUEST_TOKENS = 64_000;
const MAX_STATE_PLUS_QUESTION_TOKENS = 32_000;
const BUDGET_SAFETY = 0.8;
const CHARS_PER_TOKEN = 4;
/** Jev caps a `choice` question at this many options. */
export const MAX_CHOICE_OPTIONS = 255;
const RESPONSE_CACHE_MAX = 50;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

export interface ChoiceQuestion {
	type: 'choice';
	instructions: string;
	/** Option name -> rubric (`null` when the name is self-explanatory). */
	criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
	type: 'score';
	instructions: string;
	/** Ordered levels, 2-10. */
	criteria: string[];
}

export interface NoulQuestion {
	type: 'noul';
	instructions: string;
	criteria?: { true?: string; false?: string };
}

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface ChoiceAnswer {
	type: 'choice';
	choice: string;
	probabilities: Record<string, number>;
	confidence: number;
}

export interface ScoreAnswer {
	type: 'score';
	/** Probability-weighted level index, 0..levels-1. */
	score: number;
	legend: Record<string, string>;
	/** Level index (as a string) -> probability. */
	probabilities: Record<string, number>;
	confidence: number;
}

export interface NoulAnswer {
	type: 'noul';
	/** Probability of "yes"; Jev returns no `confidence` for this type. */
	noul: number;
}

export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface DecisionUsage {
	inputTokens: number;
	outputTokens: number;
}

export interface DecisionResult<Q extends Record<string, DecisionQuestion> = Record<string, DecisionQuestion>> {
	answers: { [K in keyof Q]: AnswerFor<Q[K]> };
	usage: DecisionUsage;
	/** Number of HTTP requests the question map was split into (0 when fully served from cache). */
	requests: number;
}

export type AnswerFor<Q extends DecisionQuestion> =
	Q extends ChoiceQuestion ? ChoiceAnswer :
	Q extends ScoreQuestion ? ScoreAnswer :
	NoulAnswer;

/** Request options for the System 1 lane; `onSystemOne` fires when a seat's result came from the lane. */
export interface DecisionRequestOptions extends AIRequestOptions {
	onSystemOne?: () => void;
}

export type DecisionLaneFailure = 'disabled' | 'unauthorized' | 'invalid-request' | 'budget' | 'malformed-response';

/** The lane cannot serve this request; callers fall back to the generative path. */
export class DecisionLaneError extends Error {
	constructor(readonly reason: DecisionLaneFailure, detail: string) {
		super(`System 1 lane unavailable (${reason}): ${redactSecrets(detail)}`);
		this.name = 'DecisionLaneError';
	}
}

export function choice(instructions: string, criteria: Record<string, string | null>): ChoiceQuestion {
	return { type: 'choice', instructions, criteria };
}

export function score(instructions: string, levels: string[]): ScoreQuestion {
	return { type: 'score', instructions, criteria: levels };
}

export function noul(instructions: string, criteria?: { true?: string; false?: string }): NoulQuestion {
	return criteria ? { type: 'noul', instructions, criteria } : { type: 'noul', instructions };
}

/** Routing confidence for any answer type; a noul's is how far it sits from 0.5. */
export function answerConfidence(answer: DecisionAnswer): number {
	return answer.type === 'noul' ? Math.max(answer.noul, 1 - answer.noul) : answer.confidence;
}

export function estimateTokens(value: unknown): number {
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Split a question map into request-sized chunks; throws `budget` when the state plus one question cannot fit. */
export function chunkQuestions<Q extends DecisionQuestion>(
	state: string,
	questions: Record<string, Q>,
): Array<Record<string, Q>> {
	const stateTokens = estimateTokens(state);
	const pairBudget = MAX_STATE_PLUS_QUESTION_TOKENS * BUDGET_SAFETY;
	const requestBudget = MAX_REQUEST_TOKENS * BUDGET_SAFETY;
	const chunks: Array<Record<string, Q>> = [];
	let current: Record<string, Q> = {};
	let currentTokens = stateTokens;
	let currentCount = 0;

	for (const [id, question] of Object.entries(questions)) {
		const qTokens = estimateTokens(question);
		if (stateTokens + qTokens > pairBudget) {
			throw new DecisionLaneError('budget', `state (${stateTokens} tokens) + question "${id}" (${qTokens} tokens) exceeds the per-question budget`);
		}
		if (currentCount > 0 && currentTokens + qTokens > requestBudget) {
			chunks.push(current);
			current = {};
			currentTokens = stateTokens;
			currentCount = 0;
		}
		current[id] = question;
		currentTokens += qTokens;
		currentCount++;
	}
	if (currentCount > 0) chunks.push(current);
	return chunks;
}

function isProbabilityMap(value: unknown): value is Record<string, number> {
	return isRecord(value) && Object.values(value).every((v) => typeof v === 'number');
}

function parseAnswer(id: string, value: unknown): DecisionAnswer {
	if (!isRecord(value)) {
		throw new DecisionLaneError('malformed-response', `answer "${id}" is not an object`);
	}
	switch (value.type) {
		case 'choice':
			if (typeof value.choice === 'string' && isProbabilityMap(value.probabilities) && typeof value.confidence === 'number') {
				return { type: 'choice', choice: value.choice, probabilities: value.probabilities, confidence: value.confidence };
			}
			break;
		case 'score':
			if (typeof value.score === 'number' && isProbabilityMap(value.probabilities) && typeof value.confidence === 'number') {
				const legend = isRecord(value.legend)
					? Object.fromEntries(Object.entries(value.legend).map(([k, v]) => [k, String(v)]))
					: {};
				return { type: 'score', score: value.score, legend, probabilities: value.probabilities, confidence: value.confidence };
			}
			break;
		case 'noul':
			if (typeof value.noul === 'number') {
				return { type: 'noul', noul: value.noul };
			}
			break;
	}
	throw new DecisionLaneError('malformed-response', `answer "${id}" has an unexpected shape`);
}

interface ParsedResponse {
	answers: Record<string, DecisionAnswer>;
	usage: DecisionUsage;
}

function parseResponse(json: unknown, expectedIds: string[]): ParsedResponse {
	if (!isRecord(json) || !isRecord(json.answers)) {
		throw new DecisionLaneError('malformed-response', 'response has no answers map');
	}
	const answers: Record<string, DecisionAnswer> = {};
	for (const id of expectedIds) {
		answers[id] = parseAnswer(id, json.answers[id]);
	}
	const usage = isRecord(json.usage) ? json.usage : {};
	return {
		answers,
		usage: {
			inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
			outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
		},
	};
}

function isRetryable(error: unknown): boolean {
	return error instanceof ApiRequestError && (error.status === 429 || error.status === 529);
}

/**
 * Typed client for TypeSafe's System One endpoint (#558). Not an `AIProvider`:
 * Jev answers typed questions over a state and cannot serve `complete()`/`chat()`.
 */
export class DecisionClient {
	private readonly cache = new Map<string, ParsedResponse>();

	constructor(private getSettings: () => SynapseSettings) {}

	/** Lane is usable: toggle on and a key present. Callers skip the lane entirely otherwise. */
	isEnabled(): boolean {
		const { systemOne } = this.getSettings().ai;
		return systemOne.enabled && systemOne.apiKey.trim() !== '';
	}

	/** Evaluate every question against `state`, splitting across requests under the token budget and merging the answers. */
	async decide<Q extends Record<string, DecisionQuestion>>(
		state: string,
		questions: Q,
		opts?: DecisionRequestOptions,
	): Promise<DecisionResult<Q>> {
		const { ai } = this.getSettings();
		if (!this.isEnabled()) {
			throw new DecisionLaneError('disabled', 'System 1 decisions are off or no key is set');
		}
		const model = ai.systemOne.model;
		const cacheable = ai.temperature === 0 || ai.cacheResponses === true;
		const bypass = opts?.bypassCache === true;

		const merged: Record<string, DecisionAnswer> = {};
		const usage: DecisionUsage = { inputTokens: 0, outputTokens: 0 };
		let requests = 0;
		let replayed = false;

		for (const chunk of chunkQuestions(state, questions)) {
			const key = contentKey([state, JSON.stringify(chunk), model]);
			let parsed: ParsedResponse | undefined;
			if (cacheable && !bypass) {
				parsed = this.cacheGet(key);
				if (parsed) replayed = true;
			}
			if (!parsed) {
				parsed = await this.dispatch(state, chunk, model, ai.systemOne.apiKey);
				requests++;
				if (cacheable) this.cacheSet(key, parsed);
			}
			Object.assign(merged, parsed.answers);
			usage.inputTokens += parsed.usage.inputTokens;
			usage.outputTokens += parsed.usage.outputTokens;
		}
		if (replayed) opts?.onCacheHit?.();
		return { answers: merged as DecisionResult<Q>['answers'], usage, requests };
	}

	private async dispatch(
		state: string,
		questions: Record<string, DecisionQuestion>,
		model: string,
		apiKey: string,
	): Promise<ParsedResponse> {
		const body = JSON.stringify({ state, model, questions });
		try {
			const response = await withRetry(
				() => safeRequest({
					url: SYSTEM_ONE_ENDPOINT,
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${apiKey.trim()}`,
						'Content-Type': 'application/json',
					},
					body,
				}),
				RETRY_ATTEMPTS,
				RETRY_BASE_DELAY_MS,
				isRetryable,
			);
			return parseResponse(response.json, Object.keys(questions));
		} catch (error) {
			if (error instanceof ApiRequestError && error.status === 401) {
				throw new DecisionLaneError('unauthorized', error.message);
			}
			if (error instanceof ApiRequestError && error.status === 422) {
				throw new DecisionLaneError('invalid-request', error.message);
			}
			throw error;
		}
	}

	private cacheGet(key: string): ParsedResponse | undefined {
		const hit = this.cache.get(key);
		if (hit === undefined) return undefined;
		this.cache.delete(key);
		this.cache.set(key, hit);
		return hit;
	}

	private cacheSet(key: string, value: ParsedResponse): void {
		this.cache.delete(key);
		this.cache.set(key, value);
		if (this.cache.size > RESPONSE_CACHE_MAX) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) this.cache.delete(oldest);
		}
	}
}
