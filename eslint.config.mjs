// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for Synapse.
 *
 * Scope: enforce the promise-handling rules (#297) AND the type-safety rules
 * the Obsidian review flagged (#296), with type-aware linting so they cannot
 * regress. We enable an EXPLICIT list rather than the broad
 * `recommendedTypeChecked` preset: the preset would surface unrelated rules
 * (with their own, out-of-scope violations) and balloon the green-gate beyond
 * what #296/#297 actually fixed.
 *
 * The `no-unsafe-*` family and `no-unnecessary-type-assertion` are enforced on
 * shipped code only; test infrastructure (mocks/factories/`*.test.ts`) is
 * exempted in a later override block because it relies on intentionally loose
 * `any`-typed mocks — typing those out is tracked separately in #321.
 *
 * Type-aware rules need type information, supplied via `projectService` +
 * `tsconfigRootDir`. The lint glob (`src/**`) is aligned with the tsconfig's
 * `include` so `projectService` never errors on "file not included in project".
 */
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
		// Test infra is exempt from no-unsafe-* / unnecessary-assertion — tracked in #321.
		// Mocks, factories, and test files lean on deliberately loose `any`-typed
		// stubs (spy objects, `mockResolvedValue`, the Obsidian DOM mock), so the
		// type-safety family adds churn without protecting shipped code. The
		// promise rules and `no-duplicate-type-constituents` stay ON here.
		files: ['**/*.test.ts', 'src/__mocks__/**', 'src/__test-utils__/**'],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unnecessary-type-assertion': 'off',
		},
	},
);
