import { describe, it, expect } from 'vitest';
import {
	detectSchemaFor,
	isRecipeContent,
	scoreRecipeContent,
	isReceiptContent,
	scoreReceiptContent,
	isLyricsContent,
	scoreLyricsContent,
	CONTENT_SCHEMAS,
} from './content-schemas';
import type { PipelineStage, SchemaMode } from './content-schemas';

// ── Recipe Detection ──────────────────────────────────────────────────

describe('isRecipeContent', () => {
	it('detects a classic recipe with ingredients, instructions, and cooking terms', () => {
		const content = [
			'# Chocolate Chip Cookies',
			'',
			'## Ingredients',
			'- 2 cups all-purpose flour',
			'- 1 cup butter',
			'- 1 tsp vanilla extract',
			'- 2 eggs',
			'',
			'## Instructions',
			'1. Preheat oven to 375 degrees fahrenheit.',
			'2. Whisk flour, baking soda, and salt together.',
			'3. Stir in chocolate chips.',
			'4. Bake for 10 minutes.',
		].join('\n');

		expect(isRecipeContent(content)).toBe(true);
	});

	it('detects a recipe using "directions" header', () => {
		const content = [
			'# Simple Soup',
			'',
			'## Ingredients',
			'- 1 lb chicken',
			'- 2 cups broth',
			'- 1 tbsp olive oil',
			'',
			'## Directions',
			'1. Chop the chicken into cubes.',
			'2. Boil broth and simmer for 20 minutes.',
		].join('\n');

		expect(isRecipeContent(content)).toBe(true);
	});

	it('detects a recipe using "method" header', () => {
		const content = [
			'# Roasted Vegetables',
			'',
			'## Ingredients',
			'- 1 lb carrots',
			'- 2 tbsp olive oil',
			'',
			'## Method',
			'1. Preheat oven to 400 degrees celsius.',
			'2. Dice vegetables and roast for 30 minutes.',
		].join('\n');

		expect(isRecipeContent(content)).toBe(true);
	});

	it('does not detect a news article as a recipe', () => {
		const content = [
			'# Breaking News: Economy Shows Signs of Recovery',
			'',
			'The latest economic indicators suggest a positive trend in the market.',
			'Unemployment rates have dropped to 3.5% this quarter.',
			'Analysts are optimistic about continued growth through the fiscal year.',
			'The Federal Reserve announced it will maintain current interest rates.',
		].join('\n');

		expect(isRecipeContent(content)).toBe(false);
	});

	it('does not detect meeting notes as a recipe', () => {
		const content = [
			'# Weekly Standup - March 15',
			'',
			'## Attendees',
			'- Alice, Bob, Carol',
			'',
			'## Action Items',
			'1. Alice to update the design docs by Friday.',
			'2. Bob to review the PR for the login flow.',
			'3. Carol to set up the staging environment.',
			'',
			'## Notes',
			'- Sprint velocity increased this week.',
			'- Need to prioritize bug fixes for v2.1 release.',
		].join('\n');

		expect(isRecipeContent(content)).toBe(false);
	});

	it('does not detect code documentation as a recipe', () => {
		const content = [
			'# API Reference',
			'',
			'## Installation',
			'```bash',
			'npm install my-library',
			'```',
			'',
			'## Usage',
			'```typescript',
			'import { Client } from "my-library";',
			'const client = new Client({ apiKey: "xxx" });',
			'const result = await client.query("select * from users");',
			'```',
		].join('\n');

		expect(isRecipeContent(content)).toBe(false);
	});

	it('does not detect a restaurant review as a recipe', () => {
		const content = [
			'# Best Italian Restaurants in New York',
			'',
			'I visited several Italian restaurants this month. The pasta at Carbone was',
			'outstanding. They serve a famous spicy rigatoni that everyone should try.',
			'The service was impeccable and the ambiance was fantastic.',
			'Overall, I would highly recommend this place for a special occasion.',
		].join('\n');

		expect(isRecipeContent(content)).toBe(false);
	});

	it('does not detect a nutrition article as a recipe', () => {
		const content = [
			'# Benefits of a Mediterranean Diet',
			'',
			'Studies show that a Mediterranean diet rich in olive oil, fish, and vegetables',
			'can reduce the risk of heart disease. Nutritionists recommend consuming at',
			'least 5 servings of fruits and vegetables daily. The diet emphasizes whole',
			'grains and lean proteins over processed foods.',
		].join('\n');

		expect(isRecipeContent(content)).toBe(false);
	});
});

// ── Scoring Threshold ─────────────────────────────────────────────────

describe('scoreRecipeContent', () => {
	it('returns 0 for content with no recipe signals', () => {
		const content = 'This is a plain paragraph about nothing related to cooking.';
		expect(scoreRecipeContent(content)).toBe(0);
	});

	it('gives 2 points for a structural header match', () => {
		const content = '## Ingredients\nSome text here.';
		const score = scoreRecipeContent(content);
		expect(score).toBeGreaterThanOrEqual(2);
	});

	it('gives points for cooking verbs', () => {
		const content = 'Preheat the oven. Whisk the eggs. Bake until golden.';
		const score = scoreRecipeContent(content);
		// 3 cooking verbs = 3 points
		expect(score).toBeGreaterThanOrEqual(3);
	});

	it('gives points for measurement terms', () => {
		const content = 'Use 1 cup flour and 2 tbsp sugar. Bake at 350 degrees for 30 minutes.';
		const score = scoreRecipeContent(content);
		// cup + tbsp + degrees + minutes + bake = at least 5
		expect(score).toBeGreaterThanOrEqual(5);
	});

	it('scores below threshold for borderline content', () => {
		// Only 1 cooking verb and 1 measurement term -- not enough
		const content = 'I love to bake. It usually takes about 30 minutes.';
		expect(scoreRecipeContent(content)).toBeLessThan(5);
	});
});

// ── detectSchemaFor (recipe) ──────────────────────────────────────────

describe('detectSchemaFor', () => {
	it('returns the recipe schema for recipe content', () => {
		const content = [
			'# Pancakes',
			'',
			'## Ingredients',
			'- 1 cup flour',
			'- 2 tbsp sugar',
			'- 1 tsp baking powder',
			'',
			'## Instructions',
			'1. Whisk dry ingredients.',
			'2. Stir in milk and eggs.',
			'3. Cook on a griddle for 2 minutes per side.',
		].join('\n');

		const schema = detectSchemaFor('summary', content);
		expect(schema).not.toBeNull();
		expect(schema!.id).toBe('recipe');
		expect(schema!.name).toBe('Recipe');
	});

	it('returns null for non-recipe content', () => {
		const content = [
			'# Project Status Update',
			'',
			'The new release is scheduled for next month.',
			'We have completed 80% of the planned features.',
		].join('\n');

		expect(detectSchemaFor('summary', content)).toBeNull();
	});
});

// ── Stage Gate Lock ───────────────────────────────────────────────────
// Locks the appliesTo stage gate so the transcription stage cannot
// accidentally fire summary-only schemas (recipe/receipt).

describe('detectSchemaFor stage gating', () => {
	const recipe = [
		'# Pancakes',
		'',
		'## Ingredients',
		'- 1 cup flour',
		'- 2 tbsp sugar',
		'- 1 tsp baking powder',
		'',
		'## Instructions',
		'1. Whisk dry ingredients.',
		'2. Stir in milk and eggs.',
		'3. Cook on a griddle for 2 minutes per side.',
	].join('\n');

	const receipt = [
		'TARGET',
		'Store #1234',
		'Cashier: Mike',
		'01/20/2026 10:15',
		'',
		'PAPER TOWELS          $8.99',
		'DISH SOAP             $3.49',
		'',
		'Subtotal              $12.48',
		'Tax                   $1.00',
		'Total                 $13.48',
		'',
		'Debit **** 9876',
		'Payment               $13.48',
	].join('\n');

	it('fires recipe at the summary stage', () => {
		expect(detectSchemaFor('summary', recipe)?.id).toBe('recipe');
	});

	it('fires receipt at the summary stage', () => {
		expect(detectSchemaFor('summary', receipt)?.id).toBe('receipt');
	});

	it('does NOT fire recipe at the transcription stage', () => {
		expect(detectSchemaFor('transcription', recipe)).toBeNull();
	});

	it('does NOT fire receipt at the transcription stage', () => {
		expect(detectSchemaFor('transcription', receipt)).toBeNull();
	});
});

// ── Schema Shape Validation ───────────────────────────────────────────

describe('CONTENT_SCHEMAS', () => {
	const VALID_STAGES: PipelineStage[] = ['transcription', 'summary'];
	const VALID_MODES: SchemaMode[] = ['reformat', 'summarize'];

	it('each schema has a valid id, name, detect function, and prompt', () => {
		for (const schema of CONTENT_SCHEMAS) {
			expect(typeof schema.id).toBe('string');
			expect(schema.id.length).toBeGreaterThan(0);
			expect(typeof schema.name).toBe('string');
			expect(schema.name.length).toBeGreaterThan(0);
			expect(typeof schema.detect).toBe('function');
			expect(typeof schema.prompt).toBe('string');
			expect(schema.prompt.length).toBeGreaterThan(0);
		}
	});

	it('each schema declares a non-empty appliesTo with valid stages', () => {
		for (const schema of CONTENT_SCHEMAS) {
			expect(Array.isArray(schema.appliesTo)).toBe(true);
			expect(schema.appliesTo.length).toBeGreaterThan(0);
			for (const stage of schema.appliesTo) {
				expect(VALID_STAGES).toContain(stage);
			}
		}
	});

	it('each schema declares a valid mode', () => {
		for (const schema of CONTENT_SCHEMAS) {
			expect(VALID_MODES).toContain(schema.mode);
		}
	});

	it('recipe schema prompt includes structured output instructions', () => {
		const recipe = CONTENT_SCHEMAS.find(s => s.id === 'recipe');
		expect(recipe).toBeDefined();
		expect(recipe!.prompt).toContain('Ingredients');
		expect(recipe!.prompt).toContain('Instructions');
		expect(recipe!.prompt).toContain('Notes');
	});
});

// ── RECIPE_PROMPT Content ────────────────────────────────────────────

describe('RECIPE_PROMPT content', () => {
	const recipe = CONTENT_SCHEMAS.find(s => s.id === 'recipe');

	it('requires exact ingredient amounts', () => {
		expect(recipe!.prompt).toContain('exact amount');
	});

	it('instructs to preserve original measurements', () => {
		expect(recipe!.prompt).toContain('Preserve the original measurements');
	});

	it('instructs to include step images', () => {
		expect(recipe!.prompt).toContain('![step description](image-url)');
	});

	it('contains amalgamation instruction for structured data', () => {
		expect(recipe!.prompt).toContain('most complete and specific ingredient list');
		expect(recipe!.prompt).toContain('structured recipe data is present at the beginning');
	});
});

// ── Structured Data Score Boost ──────────────────────────────────────

describe('scoreRecipeContent with structured preamble', () => {
	it('gives 10-point boost when content starts with STRUCTURED RECIPE DATA', () => {
		const content = 'STRUCTURED RECIPE DATA (from page schema):\nRecipe: Test\nIngredients:\n- 1 cup flour';
		expect(scoreRecipeContent(content)).toBeGreaterThanOrEqual(10);
	});

	it('isRecipeContent returns true when structured preamble is present', () => {
		const content = 'STRUCTURED RECIPE DATA (from page schema):\nRecipe: Simple';
		expect(isRecipeContent(content)).toBe(true);
	});
});

// ── Receipt Detection ────────────────────────────────────────────────

describe('receipt content detection', () => {
	describe('isReceiptContent', () => {
		it('detects a receipt with store name, items, totals, and payment method', () => {
			const content = [
				'WALMART SUPERCENTER',
				'Store #4523',
				'123 Main St, Springfield IL',
				'03/15/2026 14:32',
				'',
				'Cashier: JANE',
				'Register: 07',
				'',
				'GREAT VALUE MILK      $3.48',
				'BANANAS 2x$0.59       $1.18',
				'BREAD WHEAT           $2.98',
				'CHEERIOS              $4.29',
				'',
				'Subtotal              $11.93',
				'Tax                   $0.72',
				'Total                 $12.65',
				'',
				'VISA **** 4521',
				'Payment               $12.65',
				'',
				'THANK YOU FOR SHOPPING AT WALMART',
			].join('\n');

			expect(isReceiptContent(content)).toBe(true);
		});

		it('does not detect an invoice as a receipt', () => {
			const content = [
				'INVOICE #INV-2026-0042',
				'',
				'Bill To: Acme Corporation',
				'1234 Business Park Drive',
				'',
				'Services Rendered:',
				'- Web Development (40 hours @ $150/hr): $6,000.00',
				'- Design Consultation (8 hours @ $120/hr): $960.00',
				'',
				'Due Date: April 15, 2026',
				'Net 30 terms apply.',
				'',
				'Please remit payment to the address above.',
			].join('\n');

			expect(isReceiptContent(content)).toBe(false);
		});

		it('does not detect a restaurant menu as a receipt', () => {
			const content = [
				'THE GOLDEN FORK - LUNCH MENU',
				'',
				'APPETIZERS',
				'Bruschetta .......................... $8.95',
				'Calamari ........................... $10.95',
				'Soup of the Day .................... $6.50',
				'',
				'ENTREES',
				'Grilled Salmon ..................... $24.95',
				'Filet Mignon ....................... $32.95',
				'Pasta Primavera .................... $16.95',
				'',
				'DESSERTS',
				'Tiramisu ........................... $9.50',
				'Cheesecake ......................... $8.50',
			].join('\n');

			expect(isReceiptContent(content)).toBe(false);
		});

		it('does not detect a product catalog as a receipt', () => {
			const content = [
				'SPRING 2026 PRODUCT CATALOG',
				'',
				'Garden Tools Collection:',
				'- Premium Pruning Shears: $24.99',
				'- Ergonomic Trowel Set: $18.99',
				'- 50ft Expandable Hose: $34.99',
				'',
				'All items available online and in-store.',
				'Free shipping on orders over $75.',
				'Visit our website for more selections.',
			].join('\n');

			expect(isReceiptContent(content)).toBe(false);
		});

		it('does not detect a bank statement as a receipt', () => {
			const content = [
				'FIRST NATIONAL BANK',
				'Monthly Statement - March 2026',
				'Account: ****7890',
				'',
				'Beginning Balance: $4,523.18',
				'',
				'03/01 Direct Deposit - Employer      +$3,200.00',
				'03/05 Electric Company               -$142.50',
				'03/10 Grocery Store                   -$87.32',
				'03/15 ATM Withdrawal                  -$200.00',
				'03/20 Online Transfer                 -$500.00',
				'',
				'Ending Balance: $6,793.36',
			].join('\n');

			expect(isReceiptContent(content)).toBe(false);
		});
	});

	describe('scoreReceiptContent', () => {
		it('returns 0 for content with no receipt signals', () => {
			const content = 'This is a plain paragraph about the weather today.';
			expect(scoreReceiptContent(content)).toBe(0);
		});

		it('gives 2 points for currency patterns', () => {
			const content = 'Item costs $5.99 in the store.';
			const score = scoreReceiptContent(content);
			// currency pattern = 2 pts, also matches LINE_ITEM_DOLLAR = +1
			expect(score).toBeGreaterThanOrEqual(2);
		});

		it('gives 2 points for total/subtotal/tax headers', () => {
			const content = 'Subtotal for all items listed above.';
			const score = scoreReceiptContent(content);
			expect(score).toBeGreaterThanOrEqual(2);
		});

		it('gives points for payment terms', () => {
			const content = 'Paid with Visa credit card. Cash back available.';
			const score = scoreReceiptContent(content);
			// visa + credit + cash = 3 points
			expect(score).toBeGreaterThanOrEqual(3);
		});

		it('gives points for receipt identifiers', () => {
			const content = 'Store #123  Cashier: Tom  Register: 4  Receipt copy';
			const score = scoreReceiptContent(content);
			// store # + cashier + register + receipt = 4 points
			expect(score).toBeGreaterThanOrEqual(4);
		});

		it('gives 1 point for date/time patterns', () => {
			const content = 'Transaction on 03/15/2026 14:32 completed.';
			const score = scoreReceiptContent(content);
			expect(score).toBeGreaterThanOrEqual(1);
		});

		it('scores below threshold for borderline content', () => {
			// Only a single dollar amount — not enough on its own
			const content = 'The price was $5.99 for one item.';
			expect(scoreReceiptContent(content)).toBeLessThan(5);
		});
	});

	describe('receipt schema shape', () => {
		it('receipt schema has valid id, name, detect function, and prompt', () => {
			const receipt = CONTENT_SCHEMAS.find(s => s.id === 'receipt');
			expect(receipt).toBeDefined();
			expect(receipt!.id).toBe('receipt');
			expect(receipt!.name).toBe('Receipt');
			expect(typeof receipt!.detect).toBe('function');
			expect(typeof receipt!.prompt).toBe('string');
			expect(receipt!.prompt.length).toBeGreaterThan(0);
		});

		it('receipt schema prompt includes structured output sections', () => {
			const receipt = CONTENT_SCHEMAS.find(s => s.id === 'receipt');
			expect(receipt).toBeDefined();
			expect(receipt!.prompt).toContain('Items');
			expect(receipt!.prompt).toContain('Totals');
			expect(receipt!.prompt).toContain('Notes');
			expect(receipt!.prompt).toContain('Store/Location');
		});
	});

	describe('detectSchemaFor for receipts', () => {
		it('returns the receipt schema for receipt content', () => {
			const content = [
				'TARGET',
				'Store #1234',
				'Cashier: Mike',
				'01/20/2026 10:15',
				'',
				'PAPER TOWELS          $8.99',
				'DISH SOAP             $3.49',
				'',
				'Subtotal              $12.48',
				'Tax                   $1.00',
				'Total                 $13.48',
				'',
				'Debit **** 9876',
				'Payment               $13.48',
			].join('\n');

			const schema = detectSchemaFor('summary', content);
			expect(schema).not.toBeNull();
			expect(schema!.id).toBe('receipt');
			expect(schema!.name).toBe('Receipt');
		});
	});
});

// ── Lyrics Detection ─────────────────────────────────────────────────

describe('lyrics content detection', () => {
	// Structured lyrics with explicit section markers and a repeated chorus.
	const BRACKETED_LYRICS = [
		'[Verse 1]',
		'City lights are calling out my name',
		'Walking down these empty streets again',
		'Every shadow tells me you are the same',
		'But I keep moving on',
		'',
		'[Chorus]',
		'We were running, running through the night',
		'Holding on to something that felt right',
		'We were running, running through the night',
		'Chasing every star in sight',
		'',
		'[Verse 2]',
		'Morning comes and washes you away',
		'All the words I never got to say',
		'Faded like a photograph in rain',
		'But I keep moving on',
		'',
		'[Chorus]',
		'We were running, running through the night',
		'Holding on to something that felt right',
		'We were running, running through the night',
		'Chasing every star in sight',
	].join('\n');

	// Real Whisper output: one run-on paragraph, no markers. Detection has to
	// rely on repetition + short-phrase statistics, not section headers.
	const RUNON_LYRICS =
		'I see the fire in your eyes, I see the fire in your eyes, dancing like the summer skies, ' +
		'we don\'t have to say goodbye, I see the fire in your eyes, I see the fire in your eyes, ' +
		'take my hand and hold it tight, we will be running through the night, ' +
		'I see the fire in your eyes, I see the fire in your eyes, na na na na, na na na na';

	describe('isLyricsContent — positives', () => {
		it('detects lyrics with [Verse]/[Chorus] markers', () => {
			expect(isLyricsContent(BRACKETED_LYRICS)).toBe(true);
		});

		it('detects run-on single-paragraph lyrics via repetition (no markers)', () => {
			expect(isLyricsContent(RUNON_LYRICS)).toBe(true);
			// The run-on case must NOT lean on section markers.
			expect(RUNON_LYRICS).not.toMatch(/\[(verse|chorus)/i);
		});
	});

	describe('isLyricsContent — false-positive guards', () => {
		const poem = [
			'The Road Not Taken',
			'',
			'Two roads diverged in a yellow wood,',
			'And sorry I could not travel both',
			'And be one traveler, long I stood',
			'And looked down one as far as I could',
			'To where it bent in the undergrowth;',
			'',
			'Then took the other, as just as fair,',
			'And having perhaps the better claim,',
			'Because it was grassy and wanted wear;',
			'Though as for that the passing there',
			'Had worn them really about the same,',
		].join('\n');

		const prose =
			'The quarterly report shows that revenue increased by twelve percent compared to the ' +
			'previous period. This growth was driven primarily by strong performance in the enterprise ' +
			'segment, which saw new customer acquisition rise significantly. Management expects this ' +
			'trend to continue into the next fiscal year, although some uncertainty remains.';

		const meetingNotes = [
			'# Team Sync — March 12',
			'',
			'Attendees: Alice, Bob, Carol.',
			'',
			'- Alice gave an update on the API migration; on track for Q2.',
			'- Bob raised concerns about the test coverage in the auth module.',
			'- Carol will follow up with design on the new onboarding flow.',
			'- Next meeting scheduled for March 19 at 10am.',
		].join('\n');

		const listHeavy = [
			'Shopping list',
			'',
			'- Milk',
			'- Eggs',
			'- Bread',
			'- Coffee beans',
			'- Olive oil',
			'- Spinach',
			'- Chicken thighs',
			'- Greek yogurt',
		].join('\n');

		const recipe = [
			'## Banana Bread',
			'',
			'Ingredients:',
			'- 3 ripe bananas',
			'- 2 cups flour',
			'- 1 cup sugar',
			'',
			'Instructions:',
			'1. Preheat oven to 350 degrees.',
			'2. Mash the bananas in a large bowl.',
			'3. Bake for 60 minutes.',
		].join('\n');

		it.each([
			['a poem', poem],
			['a prose paragraph', prose],
			['meeting notes', meetingNotes],
			['a list-heavy note', listHeavy],
			['a recipe', recipe],
		])('does not flag %s as lyrics', (_label, content) => {
			expect(scoreLyricsContent(content)).toBeLessThan(5);
			expect(isLyricsContent(content)).toBe(false);
		});
	});

	describe('detectSchemaFor — lyrics stage gating', () => {
		it('fires lyrics at the transcription stage', () => {
			expect(detectSchemaFor('transcription', BRACKETED_LYRICS)?.id).toBe('lyrics');
		});

		it('does NOT fire lyrics at the summary stage', () => {
			expect(detectSchemaFor('summary', BRACKETED_LYRICS)).toBeNull();
		});
	});

	describe('lyrics schema shape', () => {
		const lyrics = CONTENT_SCHEMAS.find(s => s.id === 'lyrics');

		it('is registered with transcription applicability and reformat mode', () => {
			expect(lyrics).toBeDefined();
			expect(lyrics!.appliesTo).toEqual(['transcription']);
			expect(lyrics!.mode).toBe('reformat');
		});

		it('prompt preserves every line, segments verse/chorus, and reuses the guardrail', () => {
			expect(lyrics!.prompt).toContain('[!verse]');
			expect(lyrics!.prompt).toContain('[!chorus]');
			expect(lyrics!.prompt).toMatch(/do not (summarize|paraphrase|condense)|omit/i);
			expect(lyrics!.prompt).toContain('Not specified');
		});
	});
});
