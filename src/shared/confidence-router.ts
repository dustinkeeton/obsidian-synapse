import { redactError } from './redact';

/** Which lane produced a routed result. */
export type DecisionLane = 'system-one' | 'system-two';

export interface RoutedDecision<T> {
	value: T;
	lane: DecisionLane;
	/** Set only when the System 1 answer was accepted. */
	confidence?: number;
}

export interface ConfidenceRoute<A, T> {
	/** Resolve the System 1 answer; `null` when the lane is disabled. A `null` answer or any throw falls back. */
	systemOne: (() => Promise<A | null>) | null;
	/** Minimum confidence to act on the System 1 answer. */
	floor: number;
	confidenceOf: (answer: A) => number;
	accept: (answer: A) => T;
	/** The existing generative path; invoked at most once. */
	fallback: () => Promise<T>;
	/** Label for the fallback warning when the lane throws. */
	label?: string;
}

/** Act on the System 1 answer at or above `floor`; otherwise (or on disabled/null/error) run `fallback` exactly once. */
export async function routeByConfidence<A, T>(route: ConfidenceRoute<A, T>): Promise<RoutedDecision<T>> {
	if (route.systemOne) {
		let answer: A | null = null;
		try {
			answer = await route.systemOne();
		} catch (error) {
			console.warn(`[Synapse] System 1 lane failed${route.label ? ` (${route.label})` : ''}; using the generative path:`, redactError(error));
		}
		if (answer !== null) {
			const confidence = route.confidenceOf(answer);
			if (confidence >= route.floor) {
				return { value: route.accept(answer), lane: 'system-one', confidence };
			}
		}
	}
	return { value: await route.fallback(), lane: 'system-two' };
}

export interface ConfidencePartition<A> {
	/** Answers at or above the floor, keyed as given. */
	confident: Record<string, A>;
	/** Ids whose answer fell below the floor. */
	uncertain: string[];
}

/** Split a batch of System 1 answers by the floor so only the uncertain ids reach the generative path. */
export function partitionByConfidence<A>(
	answers: Record<string, A>,
	floor: number,
	confidenceOf: (answer: A) => number,
): ConfidencePartition<A> {
	const confident: Record<string, A> = {};
	const uncertain: string[] = [];
	for (const [id, answer] of Object.entries(answers)) {
		if (confidenceOf(answer) >= floor) {
			confident[id] = answer;
		} else {
			uncertain.push(id);
		}
	}
	return { confident, uncertain };
}
