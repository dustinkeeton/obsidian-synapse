/**
 * Content-aware formatting schemas.
 *
 * Each schema defines a detection heuristic and a specialized prompt, plus
 * metadata describing which pipeline stage(s) it applies to and whether it
 * reformats or summarizes. When auto-detection is enabled and no custom
 * prompt is set, the first matching schema's prompt is used instead of the
 * default style prompt.
 *
 * This registry is shared so both the summarize and transcription stages can
 * consult it via `detectSchemaFor(stage, content)`.
 */

export type PipelineStage = 'transcription' | 'summary';
export type SchemaMode = 'reformat' | 'summarize';

export interface ContentSchema {
	id: string;
	name: string;
	appliesTo: PipelineStage[];
	mode: SchemaMode;
	detect: (content: string) => boolean;
	prompt: string;
}

// ── Recipe Detection ──────────────────────────────────────────────────

const STRUCTURAL_PATTERNS: RegExp[] = [
	/^#{1,3}\s*(ingredients|instructions|directions|method)\b/im,
	/\b\d+\s*(?:cups?|tbsp|tsp|oz|lb|g|ml|liter)\b/i,
	/^\s*\d+\.\s+\w/m,
];

const COOKING_VERBS: string[] = [
	'preheat', 'bake', 'simmer', 'chop', 'dice', 'whisk', 'stir',
	'roast', 'grill', 'saute', 'sauté', 'fry', 'boil', 'marinate',
	'blanch', 'braise', 'broil', 'knead', 'fold', 'glaze', 'drain',
	'mince', 'slice', 'julienne', 'deglaze', 'reduce', 'season',
];

const MEASUREMENT_TERMS: string[] = [
	'cup', 'tbsp', 'tsp', 'oz', 'lb', 'gram', 'ml',
	'minutes', 'degrees', 'fahrenheit', 'celsius',
];

/**
 * Score content for recipe-like characteristics.
 * Returns true if the score meets or exceeds the threshold (5).
 */
export function isRecipeContent(content: string): boolean {
	return scoreRecipeContent(content) >= 5;
}

/**
 * Compute a numeric recipe score for content. Exported for testing.
 *
 * Scoring:
 *   - Structural signals (2 pts each): section headers, quantity patterns, numbered steps
 *   - Cooking verbs (1 pt each, capped at unique matches)
 *   - Measurement terms (1 pt each, capped at unique matches)
 */
export function scoreRecipeContent(content: string): number {
	let score = 0;
	const lower = content.toLowerCase();

	// JSON-LD structured recipe data — strong signal
	if (content.startsWith('STRUCTURED RECIPE DATA')) {
		score += 10;
	}

	// Structural signals — 2 points each
	for (const pattern of STRUCTURAL_PATTERNS) {
		if (pattern.test(content)) {
			score += 2;
		}
	}

	// Cooking verbs — 1 point each unique verb
	for (const verb of COOKING_VERBS) {
		const verbPattern = new RegExp(`\\b${verb}\\b`, 'i');
		if (verbPattern.test(lower)) {
			score += 1;
		}
	}

	// Measurement terms — 1 point each unique term
	for (const term of MEASUREMENT_TERMS) {
		const termPattern = new RegExp(`\\b${term}s?\\b`, 'i');
		if (termPattern.test(lower)) {
			score += 1;
		}
	}

	return score;
}

const RECIPE_PROMPT =
	'You are summarizing recipe content. Produce a structured recipe summary using the following format:\n\n' +
	'## [Recipe Title]\n\n' +
	'**Prep time:** [time or "Not specified"]\n' +
	'**Cook time:** [time or "Not specified"]\n' +
	'**Total time:** [time or "Not specified"]\n' +
	'**Servings:** [number or "Not specified"]\n\n' +
	'### Ingredients\n' +
	'- List each ingredient with its **exact amount** (e.g. "2 cups", "1 tbsp") and preparation notes. Preserve the original measurements from the source.\n\n' +
	'### Instructions\n' +
	'1. Numbered steps, each a clear action. If the source includes images associated with a step, include them using `![step description](image-url)` on a new line after the step text.\n\n' +
	'### Notes\n' +
	'- Any tips, substitutions, or storage instructions from the original content\n\n' +
	'The source may contain the ingredient list in multiple places (e.g., structured data at the top and a narrative list further down). ' +
	'Scan the entire content and use the most complete and specific ingredient list — typically the one with exact measurements. ' +
	'If structured recipe data is present at the beginning of the content, prefer it as the canonical source.\n\n' +
	'Extract all information from the provided content. If a field is not present in the source, write "Not specified". ' +
	'Do not invent information that is not in the original text.';

// ── Receipt Detection ─────────────────────────────────────────────────

const CURRENCY_PATTERN = /(?:\$\d+\.\d{2}|[€£]\d+(?:\.\d{2})?)/;
const TOTAL_HEADERS = /\b(?:total|subtotal|sub-total|tax|grand\s*total)\b/i;
const LINE_ITEM_QTY_PRICE = /\d+\s*[x×]\s*\$?\d+/i;
const LINE_ITEM_DOLLAR = /.+\$\d+\.\d{2}/;
const RECEIPT_DATETIME = /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+\d{1,2}:\d{2}/;

/**
 * Compute a numeric receipt score for content. Exported for testing.
 *
 * Scoring:
 *   - Structural signals (2 pts each): currency patterns, "total"/"subtotal"/"tax" headers
 *   - Line-item patterns (1 pt each): quantity x price, item + dollar amount
 *   - Payment terms (1 pt each match)
 *   - Receipt identifiers (1 pt each match)
 *   - Date/time patterns (1 pt)
 */
export function scoreReceiptContent(content: string): number {
	let score = 0;

	// Structural signals — 2 points each
	if (CURRENCY_PATTERN.test(content)) {
		score += 2;
	}
	if (TOTAL_HEADERS.test(content)) {
		score += 2;
	}

	// Line-item patterns — 1 point each
	if (LINE_ITEM_QTY_PRICE.test(content)) {
		score += 1;
	}
	if (LINE_ITEM_DOLLAR.test(content)) {
		score += 1;
	}

	// Payment terms — 1 point each unique match
	const paymentKeywords = [
		'cash', 'credit', 'debit', 'visa', 'mastercard', 'amex', 'payment',
		'change due', 'amount tendered',
	];
	for (const keyword of paymentKeywords) {
		const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
		if (pattern.test(content)) {
			score += 1;
		}
	}

	// Receipt identifiers — 1 point each unique match
	const identifierKeywords = ['store #', 'register', 'cashier', 'receipt', 'transaction', 'order #'];
	for (const keyword of identifierKeywords) {
		const escaped = keyword.replace('#', '#?');
		const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
		if (pattern.test(content)) {
			score += 1;
		}
	}

	// Date/time pattern — 1 point
	if (RECEIPT_DATETIME.test(content)) {
		score += 1;
	}

	return score;
}

/**
 * Score content for receipt-like characteristics.
 * Returns true if the score meets or exceeds the threshold (5).
 */
export function isReceiptContent(content: string): boolean {
	return scoreReceiptContent(content) >= 5;
}

const RECEIPT_PROMPT =
	'You are summarizing receipt/transaction content from OCR text extraction. Produce a structured receipt summary using the following format:\n\n' +
	'## [Store Name]\n\n' +
	'**Date:** [date or "Not specified"]\n' +
	'**Store/Location:** [address or store number or "Not specified"]\n\n' +
	'### Items\n' +
	'| Item | Qty | Price |\n' +
	'|------|-----|-------|\n' +
	'| [item name] | [quantity] | [price] |\n\n' +
	'List each purchased item with its quantity and price. Preserve the original prices from the source.\n\n' +
	'### Totals\n' +
	'- **Subtotal:** [amount or "Not specified"]\n' +
	'- **Tax:** [amount or "Not specified"]\n' +
	'- **Total:** [amount]\n' +
	'- **Payment method:** [method or "Not specified"]\n\n' +
	'### Notes\n' +
	'- Any return policy, warranty information, loyalty points, or other relevant details from the receipt\n\n' +
	'Extract all information from the provided content. If a field is not present in the source, write "Not specified". ' +
	'Do not invent information that is not in the original text.';

// ── Lyrics Detection ──────────────────────────────────────────────────

// Explicit section markers — the strongest signal a transcript is song lyrics.
const LYRICS_SECTION_MARKER =
	/(\[\s*(?:verse|chorus|pre[-\s]?chorus|bridge|intro|outro|hook|refrain)\s*\d*\s*\]|\(\s*(?:bridge|chorus|hook|refrain|pre[-\s]?chorus)\s*\))/i;

// Annotations and vocable runs common to lyrics ("[x2]", "(repeat)", "la la").
const LYRICS_ANNOTATION =
	/(\[\s*x\s*\d+\s*\]|\(\s*(?:x\s*\d+|\d+\s*x|repeat)\s*\)|\b(?:la(?:\s+la)+|na(?:\s+na)+|oh(?:\s+oh)+|whoa(?:\s+whoa)+|yeah(?:\s+yeah)+)\b)/i;

/** Normalize a chunk for repetition comparison: lowercase, strip punctuation, collapse whitespace. */
function normalizeChunk(chunk: string): string {
	return chunk.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Fraction of chunks that are verbatim repeats of an earlier chunk. Choruses
 * repeat word-for-word, which is the single most distinctive statistical signal
 * for lyrics. Returns 0 below a minimum chunk count to avoid trivial-input noise.
 */
function repetitionRatio(chunks: string[]): number {
	const normalized = chunks.map(normalizeChunk).filter(c => c.length > 0);
	if (normalized.length < 6) return 0;
	const counts = new Map<string, number>();
	for (const c of normalized) counts.set(c, (counts.get(c) ?? 0) + 1);
	let repeated = 0;
	for (const n of counts.values()) if (n > 1) repeated += n - 1;
	return repeated / normalized.length;
}

/**
 * Split content into comparable segments. Prefers real line breaks; for the
 * run-on single-paragraph output Whisper typically produces, falls back to
 * splitting on sentence/clause punctuation so the statistical signals still work.
 */
function lyricSegments(text: string): string[] {
	const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
	if (lines.length >= 4) return lines;
	return text.split(/[,.;!?\n]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Score content for song-lyric characteristics. Exported for testing.
 *
 * Repetition is weighted highest because choruses repeat verbatim — a signal
 * prose, lists, notes, and recipes lack — which keeps false positives down.
 *
 * Scoring (threshold 5):
 *   - Section markers ([Verse]/[Chorus]/(Bridge)) — 2 pts
 *   - Repetition ratio — 2 pts (>= 0.15), or 3 pts (>= 0.35)
 *   - Short-segment profile — 1 pt (>= 0.6 short & unterminated), or 2 pts (>= 0.85)
 *   - Stanza structure (multiple short blank-line-delimited blocks) — 1 pt
 *   - Lyric annotations / vocable runs — 1 pt
 */
export function scoreLyricsContent(content: string): number {
	const text = content.trim();
	if (!text) return 0;
	let score = 0;

	if (LYRICS_SECTION_MARKER.test(text)) {
		score += 2;
	}

	// Repetition — the max of line- and phrase-level ratios so it fires on both
	// stanza'd lyrics and run-on paragraphs.
	const lines = text.split('\n');
	const phrases = text.split(/[\n.,;!?]+/);
	const repetition = Math.max(repetitionRatio(lines), repetitionRatio(phrases));
	if (repetition >= 0.35) {
		score += 3;
	} else if (repetition >= 0.15) {
		score += 2;
	}

	// Short-segment profile — lyric lines are short and rarely end in . ? !
	const segments = lyricSegments(text);
	if (segments.length >= 4) {
		const short = segments.filter(s => s.length <= 50).length / segments.length;
		const unterminated = segments.filter(s => !/[.?!]$/.test(s)).length / segments.length;
		if (short >= 0.85 && unterminated >= 0.85) {
			score += 2;
		} else if (short >= 0.6 && unterminated >= 0.6) {
			score += 1;
		}
	}

	// Stanza structure — multiple blank-line-delimited blocks of short lines.
	const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
	const shortBlocks = blocks.filter(b => {
		const ls = b.split('\n').map(l => l.trim()).filter(Boolean);
		return ls.length >= 2 && ls.every(l => l.length <= 60);
	});
	if (shortBlocks.length >= 2) {
		score += 1;
	}

	if (LYRICS_ANNOTATION.test(text)) {
		score += 1;
	}

	return score;
}

/**
 * Score content for song-lyric characteristics.
 * Returns true if the score meets or exceeds the threshold (5).
 */
export function isLyricsContent(content: string): boolean {
	return scoreLyricsContent(content) >= 5;
}

const LYRICS_PROMPT =
	'You are formatting a song transcript as structured lyrics. The transcript IS the lyrics — ' +
	'preserve EVERY line exactly. Do NOT summarize, paraphrase, condense, translate, or omit any line. ' +
	'Reproduce repeated sections (such as a repeated chorus) IN FULL each time they occur — never collapse ' +
	'a repeat to "Chorus (repeat)" or similar.\n\n' +
	'Produce the lyrics using the following format:\n\n' +
	'## [Song Title or "Untitled"]\n' +
	'**Artist:** [artist or "Not specified"]\n\n' +
	'Then output each section as a callout. Use `> [!verse] Verse N` for verses and `> [!chorus] Chorus` ' +
	'for choruses (use `> [!verse] Bridge`, `> [!verse] Intro`, `> [!verse] Outro` for other sections), ' +
	'with one lyric line per line inside the callout, for example:\n\n' +
	'> [!verse] Verse 1\n' +
	'> first line\n' +
	'> second line\n\n' +
	'> [!chorus] Chorus\n' +
	'> first line\n' +
	'> second line\n\n' +
	'If the transcript already contains [Verse]/[Chorus] markers, honor them; otherwise infer the ' +
	'verse/chorus structure from repetition and phrasing. If the transcript is one run-on paragraph, ' +
	'split it into natural lyric lines.\n\n' +
	'Extract all information from the provided content. If a field is not present in the source, write "Not specified". ' +
	'Do not invent information that is not in the original text.';

// ── Schema Registry ───────────────────────────────────────────────────

export const CONTENT_SCHEMAS: ContentSchema[] = [
	{
		id: 'recipe',
		name: 'Recipe',
		appliesTo: ['summary'],
		mode: 'summarize',
		detect: isRecipeContent,
		prompt: RECIPE_PROMPT,
	},
	{
		id: 'receipt',
		name: 'Receipt',
		appliesTo: ['summary'],
		mode: 'summarize',
		detect: isReceiptContent,
		prompt: RECEIPT_PROMPT,
	},
	{
		id: 'lyrics',
		name: 'Lyrics',
		appliesTo: ['transcription'],
		mode: 'reformat',
		detect: isLyricsContent,
		prompt: LYRICS_PROMPT,
	},
];

/**
 * Iterate registered schemas applicable to the given pipeline stage and
 * return the first match, or null. Order matters: recipe is checked before
 * receipt.
 */
export function detectSchemaFor(stage: PipelineStage, content: string): ContentSchema | null {
	for (const schema of CONTENT_SCHEMAS) {
		if (schema.appliesTo.includes(stage) && schema.detect(content)) {
			return schema;
		}
	}
	return null;
}
