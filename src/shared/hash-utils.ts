/**
 * Deterministic, browser-safe string hashing.
 *
 * Hand-written FNV-1a so it runs inside the Obsidian bundle, where Node's
 * `crypto` module is unavailable (and pulling it in would break the mobile
 * build). The hash is used purely for content-addressing proposals (dedup /
 * idempotency), not for security — collision resistance only needs to be good
 * enough that two genuinely different inputs almost never share a key.
 */

// FNV-1a 32-bit constants.
const FNV_PRIME = 0x01000193;
// Two distinct offset bases let us run two independent 32-bit lanes and
// concatenate them into a 64-bit (16 hex char) digest from a single pass.
const OFFSET_BASIS_LANE_A = 0x811c9dc5;
const OFFSET_BASIS_LANE_B = 0x84222325;

/**
 * Hash a string to a 16-character lowercase hex digest.
 *
 * Implementation notes:
 * - FNV-1a: for each code unit, XOR into the accumulator first, then multiply
 *   by the prime.
 * - The prime multiply MUST use `Math.imul`. Plain `*` promotes the operands to
 *   IEEE-754 doubles and silently loses the low 32 bits of precision once the
 *   product exceeds 2^53, which makes the result non-deterministic across
 *   inputs. `Math.imul` performs a true 32-bit integer multiply.
 * - Each lane is coerced with `>>> 0` to an unsigned 32-bit value before being
 *   rendered as 8 hex chars; the two lanes are concatenated.
 */
export function hashString(input: string): string {
	let laneA = OFFSET_BASIS_LANE_A;
	let laneB = OFFSET_BASIS_LANE_B;

	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		laneA ^= code;
		laneA = Math.imul(laneA, FNV_PRIME);
		laneB ^= code;
		laneB = Math.imul(laneB, FNV_PRIME);
	}

	const hexA = (laneA >>> 0).toString(16).padStart(8, '0');
	const hexB = (laneB >>> 0).toString(16).padStart(8, '0');
	return hexA + hexB;
}

/**
 * Hash an ordered list of string parts into a single content key.
 *
 * Each part is length-prefixed as `${p.length}:${p}` before the parts are
 * joined. The prefix makes the encoding unambiguous (netstring-style), so two
 * different part lists can never produce the same joined string — e.g.
 * `["a", "bc"]` and `["ab", "c"]` both naively concatenate to `"abc"` but
 * length-prefix to `"1:a2:bc"` vs `"2:ab1:c"`, which hash differently.
 */
export function contentKey(parts: string[]): string {
	const encoded = parts.map((p) => `${p.length}:${p}`).join('');
	return hashString(encoded);
}
