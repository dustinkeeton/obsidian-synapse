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

	it('importing the video barrel does not call require() for Node.js builtins at module load', async () => {
		const trapped: string[] = [];

		// Wrap require to detect Node.js builtin imports
		const wrappedRequire = ((id: string) => {
			if (nodeBuiltins.includes(id)) {
				trapped.push(id);
			}
			return originalRequire(id);
		}) as NodeRequire;
		// Copy properties from original require
		Object.assign(wrappedRequire, originalRequire);
		globalThis.require = wrappedRequire;

		// Dynamic import to trigger module evaluation after our trap is in place
		await import('./index');

		expect(trapped).toEqual([]);
	});
});
