import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('mobile safety — no top-level Node.js requires', () => {
	const nodeBuiltins = ['os', 'path', 'child_process', 'fs'];
	let originalRequire: NodeRequire;

	beforeEach(() => {
		originalRequire = globalThis.require;
	});

	afterEach(() => {
		globalThis.require = originalRequire;
		vi.resetModules();
	});

	/**
	 * Import `modulePath` with a `require` trap installed and return the list of
	 * Node-builtin ids requested during module evaluation. The desktop-only
	 * pipeline ships with `isDesktopOnly: false`, so importing any of these
	 * barrels on mobile MUST NOT trigger a Node-builtin `require` at load time —
	 * those modules don't exist there and esbuild marks them `external`, so a
	 * load-time require would crash before any `Platform.isDesktop` guard runs.
	 */
	async function trapRequiresOnImport(modulePath: string): Promise<string[]> {
		const trapped: string[] = [];

		const wrappedRequire = ((id: string) => {
			if (nodeBuiltins.includes(id)) {
				trapped.push(id);
			}
			return originalRequire(id);
		}) as NodeRequire;
		// Copy properties (cache, resolve, …) from the original require.
		Object.assign(wrappedRequire, originalRequire);
		globalThis.require = wrappedRequire;

		// Dynamic import to trigger module evaluation after the trap is in place.
		await import(modulePath);

		return trapped;
	}

	it('importing the video barrel does not require() Node builtins at module load', async () => {
		expect(await trapRequiresOnImport('./index')).toEqual([]);
	});

	it('importing the audio barrel does not require() Node builtins at module load', async () => {
		expect(await trapRequiresOnImport('../audio/index')).toEqual([]);
	});

	it('importing the transcription barrel does not require() Node builtins at module load', async () => {
		expect(await trapRequiresOnImport('../transcription/index')).toEqual([]);
	});

	it('importing the shared node-loader does not require() Node builtins at module load', async () => {
		// The loader is the single home for the lazy requires; importing it must
		// still be require-free (the requires live inside loadNodeModules()).
		expect(await trapRequiresOnImport('../shared/node-loader')).toEqual([]);
	});
});
