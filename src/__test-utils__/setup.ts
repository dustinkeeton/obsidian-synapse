// Global test setup — runs before each test file
// The obsidian module is resolved via the alias in vitest.config.ts
// pointing to src/__mocks__/obsidian.ts, so no vi.mock() call is needed.

// Vitest runs in a `node` environment, which has no DOM globals. Production
// code uses the window-scoped timer/DOM APIs that Obsidian exposes in its
// Electron renderer (`window`, `activeWindow`, `activeDocument`) for popout-
// window compatibility. In a real browser/Electron renderer `window` is the
// global object and `window.setTimeout === setTimeout`, so aliasing them to
// `globalThis` here faithfully mirrors runtime and keeps Vitest fake timers
// (which patch the global timer functions) working transparently.
const g = globalThis as Record<string, unknown>;

if (typeof g.window === 'undefined') {
	g.window = globalThis;
}
if (typeof g.activeWindow === 'undefined') {
	g.activeWindow = globalThis;
}

// `activeDocument` tracks the focused window's document. Expose it as a live
// getter so tests that stub `document` (e.g. canvas mocks) flow through to
// `activeDocument` automatically, including stubbing it to `undefined`.
if (!Object.getOwnPropertyDescriptor(globalThis, 'activeDocument')) {
	Object.defineProperty(globalThis, 'activeDocument', {
		configurable: true,
		get() {
			return g.document;
		},
	});
}
