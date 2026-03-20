/**
 * Content-aware summary templates.
 *
 * Each template defines a detection heuristic and a specialized prompt.
 * When auto-detection is enabled and no custom prompt is set, the first
 * matching template's prompt is used instead of the default style prompt.
 */

export interface ContentTemplate {
	id: string;
	name: string;
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
const PAYMENT_TERMS = /\b(?:cash|credit|debit|visa|mastercard|amex|payment|change\s*due|amount\s*tendered)\b/i;
const RECEIPT_IDENTIFIERS = /\b(?:store\s*#|register|cashier|receipt|transaction\s*#?|order\s*#?)\b/i;
const RECEIPT_DATETIME = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+\d{1,2}:\d{2}/;

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

// ── Template Registry ─────────────────────────────────────────────────

export const CONTENT_TEMPLATES: ContentTemplate[] = [
	{
		id: 'recipe',
		name: 'Recipe',
		detect: isRecipeContent,
		prompt: RECIPE_PROMPT,
	},
	{
		id: 'receipt',
		name: 'Receipt',
		detect: isReceiptContent,
		prompt: RECEIPT_PROMPT,
	},
];

/**
 * Iterate registered templates and return the first match, or null.
 */
export function detectContentTemplate(content: string): ContentTemplate | null {
	for (const template of CONTENT_TEMPLATES) {
		if (template.detect(content)) {
			return template;
		}
	}
	return null;
}
