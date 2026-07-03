// @ts-check
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import noUnredactedConsole from './scripts/eslint-rules/no-unredacted-console.mjs';

/**
 * Flat ESLint config for Synapse.
 *
 * Two layers:
 *  1. The promise-handling (#297) + type-safety (#296) rules the Obsidian review
 *     flagged, with type-aware linting so they cannot regress.
 *  2. Obsidian's official guideline rules (`obsidianmd/*`, #389) — the local
 *     mirror of the automated review every GitHub release now passes through.
 *
 * For BOTH layers we enable an EXPLICIT list rather than a broad preset.
 * `tseslint`'s `recommendedTypeChecked` and `obsidianmd.configs.recommended`
 * would each surface unrelated rules (with their own, out-of-scope violations)
 * and balloon the green-gate. Notably `obsidianmd.configs.recommended` bundles
 * the entire `typescript-eslint/recommended-type-checked` preset plus
 * import/@microsoft-sdl/depend — 100+ rules — so we lift ONLY its `obsidianmd/*`
 * entries (at the maintainers' chosen severities, tracked from upstream).
 *
 * The `no-unsafe-*` family and `no-unnecessary-type-assertion` are enforced
 * repo-wide — test infrastructure (mocks/factories/`*.test.ts`) included. The
 * override block that once exempted the test harness (for its intentionally
 * loose `any`-typed mocks) was removed once those mocks were typed out (#321).
 * Only the `obsidianmd/*` rules stay scoped to shipped code, not the test harness.
 *
 * Type-aware rules need type information, supplied via `projectService` +
 * `tsconfigRootDir`. The lint glob (`src/**`) is aligned with the tsconfig's
 * `include` so `projectService` never errors on "file not included in project".
 */

// Lift only the `obsidianmd/*` rules out of the recommended preset, dropping its
// bundled typescript-eslint/import/sdl/depend layers (see note above).
const obsidianmdRules = Object.fromEntries(
	obsidianmd.configs.recommended
		.flatMap((c) => Object.entries(c.rules ?? {}))
		.filter(([name]) => name.startsWith('obsidianmd/'))
);

// `obsidianmd/ui/sentence-case` is a blunt heuristic: left alone it would lowercase
// the brand name ("synapse" — a hard brand-guideline violation), acronyms (URL,
// OCR, MB), and product names. Allow-list the proper nouns/acronyms that appear in
// Synapse's UI copy so the rule still catches genuine Title-Case while leaving
// these correct. Multi-word product names go through `ignoreRegex`.
const UI_BRANDS = [
	'Synapse', 'Obsidian', 'Ollama', 'OpenAI', 'Anthropic', 'Claude', 'Gemini',
	'Google', 'Deepgram', 'Whisper', 'YouTube', 'TikTok', 'GitHub', 'BRAT',
	'Vertex', 'Twitter', 'Reddit',
];
const UI_ACRONYMS = [
	'AI', 'API', 'URL', 'URLs', 'OCR', 'MB', 'GB', 'KB', 'HTTP', 'HTTPS', 'TODO',
	'TBD', 'FIXME', 'PLACEHOLDER', 'REM', 'ID', 'JSON', 'YAML', 'PDF', 'CSS', 'UI',
	'HH', 'MM', 'SS',
];

export default tseslint.config(
	{
		// Replacement for `.eslintignore`: a config object with only `ignores`
		// applies globally. Keep generated/build output and JS tooling configs out.
		ignores: [
			'main.js',
			'dist/**',
			'node_modules/**',
			'esbuild.config.mjs',
			'eslint.config.mjs',
			'scripts/**',
		],
	},
	{
		files: ['src/**/*.ts'],
		// The codebase carries intentional, documented `eslint-disable` directives
		// for rules from the broader recommended preset (e.g. `no-var-requires`,
		// `no-this-alias`) that a later stack (#296) enables. Under this PR's
		// narrow, promise-only ruleset those rules are off, so ESLint would flag
		// those still-needed directives as "unused". Don't report unused directives
		// here — deleting them now would just force #296 to re-add them.
		linterOptions: {
			reportUnusedDisableDirectives: 'off',
		},
		plugins: {
			'@typescript-eslint': tseslint.plugin,
		},
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Promise-handling rules (#297).
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/prefer-promise-reject-errors': 'error',
			// Type-safety rules (#296). The on-disk JSON stores, frontmatter, AI
			// responses, and external tool output are now narrowed via
			// `src/shared/json-utils.ts` guards; these rules keep `any` from
			// silently re-entering through those (and other) boundaries.
			'@typescript-eslint/no-unsafe-assignment': 'error',
			'@typescript-eslint/no-unsafe-call': 'error',
			'@typescript-eslint/no-unsafe-member-access': 'error',
			'@typescript-eslint/no-unsafe-argument': 'error',
			'@typescript-eslint/no-unsafe-return': 'error',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
			'@typescript-eslint/no-duplicate-type-constituents': 'error',
		},
	},
	{
		// Obsidian guideline gate (#389) — the local mirror of the store's automated
		// review (a release that fails it is silently pulled within 24h). Scoped to
		// SHIPPED code only via the `ignores` below: test infra isn't bundled into
		// main.js, so Obsidian never reviews it. Inherits the type-aware parser from
		// the src block above.
		files: ['src/**/*.ts'],
		ignores: ['**/*.test.ts', 'src/__mocks__/**', 'src/__test-utils__/**'],
		plugins: {
			obsidianmd,
		},
		rules: {
			...obsidianmdRules,
			'obsidianmd/ui/sentence-case': [
				'error',
				{
					brands: UI_BRANDS,
					acronyms: UI_ACRONYMS,
					// Known false positives the heuristic can't resolve:
					//  - multi-word product names;
					//  - the plural "URLs" (the rule wants the nonsensical "URLS");
					//  - literal URL placeholders (it would upper-case the scheme);
					//  - "e.g." read as a sentence end → wrongly capitalizes the
					//    following common noun (e.g. "recipes" → "Recipes");
					//  - a quoted command name referenced mid-sentence, whose own
					//    (already sentence-case) capitalization must be preserved.
					ignoreRegex: [
						'GitHub Sponsors',
						'Buy Me a Coffee',
						'URLs',
						'^https?://',
						'e\\.g\\.',
						'Scan folder for stub notes',
					],
				},
			],
		},
	},
	{
		// redactError() contract gate (#418) — every value reaching a `console.*`
		// sink must be statically string-like or routed through redact.ts
		// (`redactError`/`redactSecrets` return `string`, so sanctioned sites pass
		// with no name allowlist). Type-aware, so it inspects template-literal
		// substitutions and `+` concatenation too; see the rule's header comment
		// for the full contract and accepted residual gaps. Scoped to SHIPPED
		// code like the obsidianmd block above: test infra isn't bundled into
		// main.js, and its console output never reaches a user's devtools where a
		// live secret could sit. Inherits the type-aware parser from the src
		// block above.
		files: ['src/**/*.ts'],
		ignores: ['**/*.test.ts', 'src/__mocks__/**', 'src/__test-utils__/**'],
		plugins: {
			synapse: {
				rules: {
					'no-unredacted-console': noUnredactedConsole,
				},
			},
		},
		rules: {
			'synapse/no-unredacted-console': 'error',
		},
	},
);
