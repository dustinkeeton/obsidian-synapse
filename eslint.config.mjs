// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for Synapse.
 *
 * Scope: enforce ONLY the three promise-handling rules that the Obsidian
 * review flagged, with type-aware linting so they cannot regress. The broad
 * `recommendedTypeChecked` preset (and the `no-unsafe-*` family in particular)
 * is intentionally NOT enabled here — those violations are addressed by a
 * separate stack (#296). Adding them now would fail CI.
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
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/prefer-promise-reject-errors': 'error',
		},
	},
);
