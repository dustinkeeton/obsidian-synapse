/**
 * Ambient declaration so `tsc` accepts `import X from '*.md'`. The real content
 * is inlined as a string at build time by esbuild's `.md` text loader (see
 * esbuild.config.mjs); TypeScript never reads the file, it just types the import
 * as a string. Used by changelog-modal.ts to bundle CHANGELOG.md (#375).
 */
declare module '*.md' {
	const content: string;
	export default content;
}
