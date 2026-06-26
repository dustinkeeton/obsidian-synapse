import { MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import type SynapsePlugin from './main';
import type { SynapseSettings } from './settings';

/**
 * Auto-fold note Properties on open (#381).
 *
 * Obsidian exposes no public API for the Properties (frontmatter) fold state,
 * and the plugin does no other editor-DOM manipulation, so this module is
 * written DEFENSIVELY: every lookup is guarded and nothing throws on the
 * open/render path. A wrong selector or an unexpected DOM shape degrades to a
 * silent no-op and can NEVER break note rendering.
 *
 * Mechanism (JS, not CSS): we add Obsidian's OWN collapsed class to the
 * Properties container AND its heading collapse chevron, mirroring exactly what
 * happens when a user clicks the Properties heading to fold it. Obsidian flags
 * the fold on both elements, so collapsing the container alone would leave the
 * chevron still rotated "open". This is preferred over a CSS rule because:
 *   1. It reuses Obsidian's native collapse state, so the panel STILL EXPANDS
 *      on a heading click — a persistent CSS `display:none` rule would fight
 *      that and trap the panel closed (violating "still expandable").
 *   2. It is a one-time "on open" action, not an always-on override, so a panel
 *      the user expands stays expanded for that view session.
 *   3. No custom CSS is required — Obsidian already styles `is-collapsed`.
 *
 * LIVE-OBSIDIAN VERIFICATION REQUIRED (minAppVersion 1.7.2): the selector and
 * collapsed-class constants below are Obsidian internals, not a public contract,
 * and could not be confirmed against a running app here. Verify that the
 * Properties panel container matches {@link METADATA_CONTAINER_SELECTOR} and
 * that folding toggles {@link PROPERTIES_COLLAPSED_CLASS} on that element.
 */

/** Selector for a note's Properties (frontmatter) panel container. */
export const METADATA_CONTAINER_SELECTOR = '.metadata-container';

/** Class Obsidian applies to a collapsed Properties panel container. */
export const PROPERTIES_COLLAPSED_CLASS = 'is-collapsed';

/**
 * Selector for the Properties heading's collapse chevron, found inside the
 * container. Obsidian toggles {@link PROPERTIES_COLLAPSED_CLASS} on this element
 * (rotating the triangle) in lockstep with the container's own fold state.
 */
export const PROPERTIES_COLLAPSE_INDICATOR_SELECTOR = '.collapse-indicator.collapse-icon';

/** The minimal `classList` surface this module reads and mutates. */
interface ClassListLike {
	contains(token: string): boolean;
	add(token: string): void;
}

/** The minimal element surface needed to collapse the Properties panel. */
interface ElementLike {
	classList?: ClassListLike | null;
	querySelector?: ((selectors: string) => ElementLike | null) | null;
}

/** The minimal element surface needed to find the Properties panel. */
interface QueryRoot {
	querySelector(selectors: string): ElementLike | null;
}

/** The minimal view surface needed to locate the Properties panel within it. */
interface ViewLike {
	containerEl?: QueryRoot | null;
	contentEl?: QueryRoot | null;
}

/**
 * Add the collapsed class to the Properties heading's collapse chevron inside
 * `container`, so the rotated triangle matches a folded panel (#384 review).
 * Obsidian flags the fold on this indicator as well as the container itself.
 * Fully guarded: a missing indicator, or a container that cannot query its
 * descendants, is a silent no-op — never a throw on the open/render path.
 */
function collapsePropertiesIndicator(container: ElementLike | null | undefined): void {
	if (!container || typeof container.querySelector !== 'function') return;
	const indicator = container.querySelector(PROPERTIES_COLLAPSE_INDICATOR_SELECTOR);
	const classList = indicator?.classList;
	if (classList && !classList.contains(PROPERTIES_COLLAPSED_CLASS)) {
		classList.add(PROPERTIES_COLLAPSED_CLASS);
	}
}

/**
 * Collapse the Properties panel found inside `root`, mirroring the state
 * Obsidian sets when a user folds it. Returns `true` only when it actually
 * changed the DOM (collapsed a previously-expanded panel); `false` for every
 * no-op (root missing, panel absent, already collapsed, or any error).
 */
export function foldPropertiesIn(root: QueryRoot | null | undefined): boolean {
	try {
		if (!root || typeof root.querySelector !== 'function') return false;
		const container = root.querySelector(METADATA_CONTAINER_SELECTOR);
		const classList = container?.classList;
		if (!classList) return false;
		// Already folded → leave Obsidian's own state untouched.
		if (classList.contains(PROPERTIES_COLLAPSED_CLASS)) return false;
		classList.add(PROPERTIES_COLLAPSED_CLASS);
		// Mirror a manual fold's chevron so the rotated triangle matches the
		// now-collapsed panel; the container alone leaves it pointing "open".
		collapsePropertiesIndicator(container);
		return true;
	} catch {
		// The open path must never throw — a wrong selector is a no-op, not a crash.
		return false;
	}
}

/**
 * Apply the auto-fold to a single view when `enabled`. Looks first in the
 * broadest per-view root (`containerEl`) and falls back to the content root.
 * No-op (returns `false`) when disabled, when the view is missing, or when no
 * foldable panel is present.
 */
export function applyPropertiesFold(
	view: ViewLike | null | undefined,
	enabled: boolean,
): boolean {
	if (!enabled || !view) return false;
	if (foldPropertiesIn(view.containerEl)) return true;
	return foldPropertiesIn(view.contentEl);
}

/**
 * Fold the active note's Properties panel when `enabled`. Resolves the active
 * markdown view and defers to {@link applyPropertiesFold}. Fully guarded: a
 * disabled flag short-circuits before touching the workspace, and any failure
 * resolving the view degrades to a no-op.
 */
export function foldActiveNoteProperties(app: App, enabled: boolean): boolean {
	if (!enabled) return false;
	try {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		return applyPropertiesFold(view, enabled);
	} catch {
		return false;
	}
}

/**
 * Wire the auto-fold behavior into the plugin lifecycle (#381). The single
 * call main.ts makes; encapsulates all workspace-event registration and timer
 * teardown here so main.ts stays a thin orchestrator.
 *
 * Triggers:
 *   - `onLayoutReady` — fold the note already open at load (`file-open` does
 *     not fire for the workspace-restored active file).
 *   - `file-open` — the "on open" trigger; fires when a leaf loads a file.
 *
 * Each trigger attempts the fold immediately AND once more on the next
 * macrotask, in case the Properties panel renders just after the event. The
 * "already collapsed" guard makes the second pass a cheap no-op when the first
 * succeeded. Switching to an already-open tab does NOT re-fold (no `file-open`),
 * so a panel the user expands is preserved.
 */
export function registerPropertiesAutoFold(
	plugin: SynapsePlugin,
	getSettings: () => SynapseSettings,
): void {
	const pendingTimeouts = new Set<number>();

	const apply = (): void => {
		foldActiveNoteProperties(plugin.app, getSettings().ui.autoFoldProperties);
	};

	const scheduleApply = (): void => {
		apply();
		const id = window.setTimeout(() => {
			pendingTimeouts.delete(id);
			apply();
		}, 0);
		pendingTimeouts.add(id);
	};

	// Clear any in-flight deferred passes on unload.
	plugin.register(() => {
		for (const id of pendingTimeouts) window.clearTimeout(id);
		pendingTimeouts.clear();
	});

	plugin.app.workspace.onLayoutReady(() => scheduleApply());
	plugin.registerEvent(plugin.app.workspace.on('file-open', () => scheduleApply()));
}
