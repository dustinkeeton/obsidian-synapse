export interface TranscriptSegment {
	/** Raw slice to rewrite; all bodies concatenate back to the original text. */
	body: string;
	/** Word-aligned tail of the previous body, sent for continuity only. */
	context: string;
}

const PARAGRAPH_BREAK = /\n(?:[ \t]*\n)+/g;
const LINE_BREAK = /\n/g;
const SENTENCE_END = /[.!?]+["')\]]*\s+/g;
const WORD_GAP = /\s+/g;

/** Split `text` after every match of `separator`, keeping the separator on the preceding unit. */
function splitAfter(text: string, separator: RegExp): string[] {
	const units: string[] = [];
	let last = 0;
	const re = new RegExp(separator.source, 'g');
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const end = match.index + match[0].length;
		if (end === last) {
			re.lastIndex++;
			continue;
		}
		units.push(text.slice(last, end));
		last = end;
	}
	if (last < text.length) units.push(text.slice(last));
	return units;
}

function refine(units: string[], separator: RegExp, maxChars: number): string[] {
	return units.flatMap((unit) => (unit.length <= maxChars ? [unit] : splitAfter(unit, separator)));
}

function hardCut(units: string[], maxChars: number): string[] {
	return units.flatMap((unit) => {
		if (unit.length <= maxChars) return [unit];
		const pieces: string[] = [];
		for (let i = 0; i < unit.length; i += maxChars) pieces.push(unit.slice(i, i + maxChars));
		return pieces;
	});
}

function overlapTail(previous: string, overlapChars: number): string {
	const trimmed = previous.trimEnd();
	if (overlapChars <= 0 || trimmed.length === 0) return '';
	if (trimmed.length <= overlapChars) return trimmed.trim();
	let tail = trimmed.slice(-overlapChars);
	const cutMidWord = !/\s/.test(trimmed.charAt(trimmed.length - overlapChars - 1));
	if (cutMidWord) {
		const gap = tail.search(/\s/);
		tail = gap >= 0 ? tail.slice(gap) : '';
	}
	return tail.trim();
}

/**
 * Split a transcript into segments of at most `maxChars`, preferring
 * paragraph, then line, then sentence, then word boundaries.
 */
export function segmentTranscript(text: string, maxChars: number, overlapChars: number): TranscriptSegment[] {
	const budget = Math.max(1, Math.floor(maxChars));
	if (text.length === 0) return [];
	if (text.length <= budget) return [{ body: text, context: '' }];

	let units = refine([text], PARAGRAPH_BREAK, budget);
	units = refine(units, LINE_BREAK, budget);
	units = refine(units, SENTENCE_END, budget);
	units = refine(units, WORD_GAP, budget);
	units = hardCut(units, budget);

	const bodies: string[] = [];
	let current = '';
	for (const unit of units) {
		if (current.length > 0 && current.length + unit.length > budget) {
			bodies.push(current);
			current = '';
		}
		current += unit;
	}
	if (current.length > 0) bodies.push(current);

	return bodies.map((body, i) => ({
		body,
		context: i === 0 ? '' : overlapTail(bodies[i - 1], overlapChars),
	}));
}

/** Drop a verbatim repeat of `context` from the start of a rewritten segment. */
export function trimRepeatedContext(output: string, context: string): string {
	if (context.length === 0 || output.length <= context.length) return output;
	return output.startsWith(context) ? output.slice(context.length).trimStart() : output;
}
