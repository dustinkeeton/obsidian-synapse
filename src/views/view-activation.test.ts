import { describe, it, expect, vi } from 'vitest';
import { activateUnifiedView, activateSynapseActionsView, refreshUnifiedView, watchInProgress } from './view-activation';
import { InProgressRegistry } from '../shared/in-progress-registry';
import type { UnifiedViewSources } from './view-activation';
import { SYNAPSE_ACTIONS_VIEW_TYPE } from './synapse-actions-view';
import type { Workspace, WorkspaceLeaf } from 'obsidian';
import { UNIFIED_VIEW_TYPE, UnifiedProposalView, type UnifiedItem, type UnifiedViewCallbacks } from './unified-proposal-view';
import { NotificationManager } from '../shared/notifications';
import { createEl, type StubEl } from '../__mocks__/obsidian';

function makeSources(): UnifiedViewSources {
	return {
		elaboration: vi.fn().mockResolvedValue([{ id: 'e1' }]),
		enrichment: vi.fn().mockResolvedValue([{ id: 'n1' }]),
		organize: vi.fn().mockResolvedValue([]),
		'deep-dive': vi.fn().mockResolvedValue([{ id: 'd1' }]),
		title: vi.fn().mockResolvedValue([]),
		rem: vi.fn().mockResolvedValue([{ id: 'r1' }]),
		illustrate: vi.fn().mockResolvedValue([]),
		checkpoints: vi.fn().mockResolvedValue([{ id: 'cp1' }]),
		inProgress: vi.fn().mockReturnValue([]),
	};
}

function makeLeaf() {
	return {
		view: { setItems: vi.fn(), setCheckpoints: vi.fn(), setInProgress: vi.fn() },
		setViewState: vi.fn().mockResolvedValue(undefined),
	};
}

function makeWorkspace(leaves: Record<string, ReturnType<typeof makeLeaf>[]>, rightLeaf: ReturnType<typeof makeLeaf> | null = null) {
	return {
		getLeavesOfType: vi.fn((type: string) => leaves[type] ?? []),
		getRightLeaf: vi.fn().mockReturnValue(rightLeaf),
		revealLeaf: vi.fn().mockResolvedValue(undefined),
	};
}

describe('refreshUnifiedView', () => {
	it('is a no-op (reads nothing) when no unified view is open', async () => {
		const sources = makeSources();
		await refreshUnifiedView(makeWorkspace({}) as unknown as Workspace, sources);
		expect(sources.elaboration).not.toHaveBeenCalled();
	});

	it('pushes every kind in fixed order plus checkpoints into each open view', async () => {
		const a = makeLeaf();
		const b = makeLeaf();
		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [a, b] });
		await refreshUnifiedView(workspace as unknown as Workspace, makeSources());
		const items = a.view.setItems.mock.calls[0][0] as Array<{ kind: string; data: { id: string } }>;
		expect(items.map((i) => `${i.kind}:${i.data.id}`)).toEqual([
			'elaboration:e1', 'enrichment:n1', 'deep-dive:d1', 'rem:r1',
		]);
		expect(a.view.setCheckpoints).toHaveBeenCalledWith([{ id: 'cp1' }]);
		expect(b.view.setItems).toHaveBeenCalledTimes(1);
	});
});

describe('refreshUnifiedView — deferred leaves (Obsidian >= 1.7.2)', () => {
	it('loads a deferred leaf before populating it', async () => {
		const real = { setItems: vi.fn(), setCheckpoints: vi.fn(), setInProgress: vi.fn() };
		const leaf = {
			view: {} as unknown,
			isDeferred: true,
			loadIfDeferred: vi.fn(async () => { leaf.view = real; leaf.isDeferred = false; }),
			setViewState: vi.fn(),
		};
		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [leaf as unknown as ReturnType<typeof makeLeaf>] });
		await refreshUnifiedView(workspace as unknown as Workspace, makeSources());
		expect(leaf.loadIfDeferred).toHaveBeenCalledTimes(1);
		expect(real.setItems).toHaveBeenCalledTimes(1);
		expect(real.setCheckpoints).toHaveBeenCalledWith([{ id: 'cp1' }]);
	});

	it('skips a leaf whose view still lacks the view methods and keeps populating the others', async () => {
		const placeholder = { view: { setItems: 'nope' }, isDeferred: false, setViewState: vi.fn() };
		const ok = makeLeaf();
		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [placeholder as unknown as ReturnType<typeof makeLeaf>, ok] });
		await expect(refreshUnifiedView(workspace as unknown as Workspace, makeSources())).resolves.toBeUndefined();
		expect(ok.view.setItems).toHaveBeenCalledTimes(1);
	});
});

describe('activateUnifiedView', () => {
	it('reuses an existing leaf, reveals it, and refreshes', async () => {
		const leaf = makeLeaf();
		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [leaf] });
		await activateUnifiedView(workspace as unknown as Workspace, makeSources());
		expect(leaf.setViewState).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
		expect(leaf.view.setItems).toHaveBeenCalledTimes(1);
	});

	it('creates the view in the right sidebar when absent', async () => {
		const right = makeLeaf();
		const leaves: Record<string, ReturnType<typeof makeLeaf>[]> = {};
		const workspace = makeWorkspace(leaves, right);
		right.setViewState.mockImplementation(async () => { leaves[UNIFIED_VIEW_TYPE] = [right]; });
		await activateUnifiedView(workspace as unknown as Workspace, makeSources());
		expect(right.setViewState).toHaveBeenCalledWith({ type: UNIFIED_VIEW_TYPE, active: true });
		expect(workspace.revealLeaf).toHaveBeenCalledWith(right);
		expect(right.view.setItems).toHaveBeenCalledTimes(1);
	});

	it('gives up quietly when no right leaf is available', async () => {
		const workspace = makeWorkspace({}, null);
		const sources = makeSources();
		await activateUnifiedView(workspace as unknown as Workspace, sources);
		expect(workspace.revealLeaf).not.toHaveBeenCalled();
		expect(sources.elaboration).not.toHaveBeenCalled();
	});
});

describe('activateSynapseActionsView', () => {
	it('creates and reveals the actions view', async () => {
		const right = makeLeaf();
		const workspace = makeWorkspace({}, right);
		await activateSynapseActionsView(workspace as unknown as Workspace);
		expect(right.setViewState).toHaveBeenCalledWith({ type: SYNAPSE_ACTIONS_VIEW_TYPE, active: true });
		expect(workspace.revealLeaf).toHaveBeenCalledWith(right);
	});

	it('reveals the existing actions view without re-creating it', async () => {
		const leaf = makeLeaf();
		const workspace = makeWorkspace({ [SYNAPSE_ACTIONS_VIEW_TYPE]: [leaf] });
		await activateSynapseActionsView(workspace as unknown as Workspace);
		expect(leaf.setViewState).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
	});
});

describe('refreshUnifiedView — in progress', () => {
	it('pushes the registry snapshot taken after the sources load', async () => {
		const leaf = makeLeaf();
		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [leaf] });
		const sources = makeSources();
		const entry = { id: 'op-1', kind: 'elaboration', label: 'Scanning', startedAt: 1, cancellable: true };
		sources.inProgress = vi.fn().mockReturnValue([entry]);
		await refreshUnifiedView(workspace as unknown as Workspace, sources);
		expect(leaf.view.setInProgress).toHaveBeenCalledWith([entry]);
		expect(sources.inProgress).toHaveBeenCalledTimes(1);
	});
});

describe('watchInProgress', () => {
	function setup() {
		const leaf = makeLeaf();
		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [leaf] });
		const registry = new InProgressRegistry();
		const sources = makeSources();
		sources.inProgress = () => registry.snapshot();
		const stop = watchInProgress(workspace as unknown as Workspace, sources, registry);
		return { leaf, registry, sources, stop };
	}

	it('reloads every source when an operation starts', async () => {
		const { leaf, registry, sources } = setup();
		registry.begin({ id: 'op-1', kind: 'rem', label: 'REM', cancellable: true });
		await vi.waitFor(() => expect(leaf.view.setInProgress).toHaveBeenCalled());
		expect(sources.elaboration).toHaveBeenCalledTimes(1);
		expect(leaf.view.setInProgress.mock.calls[0][0]).toHaveLength(1);
	});

	it('pushes progress ticks without reloading the sources', async () => {
		const { leaf, registry, sources } = setup();
		registry.begin({ id: 'op-1', kind: 'rem', label: 'REM', cancellable: true });
		await vi.waitFor(() => expect(leaf.view.setInProgress).toHaveBeenCalledTimes(1));
		registry.update('op-1', { current: 2, total: 5 });
		expect(sources.elaboration).toHaveBeenCalledTimes(1);
		expect(leaf.view.setInProgress).toHaveBeenLastCalledWith([expect.objectContaining({ current: 2, total: 5 })]);
	});

	it('hands a finished row off to its proposals in one refresh', async () => {
		const { leaf, registry, sources } = setup();
		registry.begin({ id: 'op-1', kind: 'elaboration', label: 'Scanning', cancellable: true });
		await vi.waitFor(() => expect(leaf.view.setInProgress).toHaveBeenCalledTimes(1));
		sources.elaboration = vi.fn().mockResolvedValue([{ id: 'fresh' }]);
		registry.end('op-1');
		await vi.waitFor(() => expect(leaf.view.setInProgress).toHaveBeenCalledTimes(2));
		const lastItems = leaf.view.setItems.mock.lastCall?.[0] as Array<{ data: { id: string } }>;
		expect(lastItems.map((i) => i.data.id)).toContain('fresh');
		expect(leaf.view.setInProgress).toHaveBeenLastCalledWith([]);
	});

	it('stops listening once unsubscribed', () => {
		const { registry, sources, stop } = setup();
		stop();
		registry.begin({ id: 'op-1', kind: 'rem', label: 'REM', cancellable: true });
		expect(sources.elaboration).not.toHaveBeenCalled();
	});
});

describe('watchInProgress — open review (real view)', () => {
	const proposal = {
		id: 'e1', sourceNotePath: 'notes/a.md', createdAt: '2026-01-01T00:00:00Z',
		detectionReasons: [{ type: 'short-note', wordCount: 3 }], originalContent: 'x',
		proposedAdditions: 'AI draft', insertionPoint: 'append', status: 'pending',
	};

	function textareas(root: StubEl): StubEl[] {
		const out: StubEl[] = [];
		const walk = (el: StubEl) => {
			for (const child of el.children as unknown as StubEl[]) {
				if (child.tagName === 'TEXTAREA') out.push(child);
				walk(child);
			}
		};
		walk(root);
		return out;
	}

	it('keeps the review draft when an unrelated operation starts and ends', async () => {
		const leaf = { view: null as unknown, setViewState: vi.fn() };
		const view = new UnifiedProposalView(leaf as unknown as WorkspaceLeaf, {} as UnifiedViewCallbacks, new NotificationManager());
		const internals = view as unknown as { contentEl: StubEl; reviewingElaboration: unknown; render(): void };
		internals.contentEl = createEl();
		leaf.view = view;
		view.setItems([{ kind: 'elaboration', data: proposal } as unknown as UnifiedItem]);
		internals.reviewingElaboration = proposal;
		internals.render();
		const [editor] = textareas(internals.contentEl);
		editor.value = 'user edit';

		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [leaf as unknown as ReturnType<typeof makeLeaf>] });
		const registry = new InProgressRegistry();
		const sources = makeSources();
		sources.elaboration = vi.fn().mockResolvedValue([proposal]);
		sources.inProgress = () => registry.snapshot();
		watchInProgress(workspace as unknown as Workspace, sources, registry);

		registry.begin({ id: 'title-1', kind: 'title', label: 'Checking title', cancellable: false });
		await vi.waitFor(() => expect(sources.elaboration).toHaveBeenCalledTimes(1));
		registry.end('title-1');
		await vi.waitFor(() => expect(sources.elaboration).toHaveBeenCalledTimes(2));
		await refreshUnifiedView(workspace as unknown as Workspace, sources);

		const after = textareas(internals.contentEl);
		expect(after).toHaveLength(1);
		expect(after[0]).toBe(editor);
		expect(after[0].value).toBe('user edit');
	});
});

describe('refreshUnifiedView — overlapping refreshes', () => {
	function deferred<T>() {
		let resolve!: (value: T) => void;
		const promise = new Promise<T>((r) => { resolve = r; });
		return { promise, resolve };
	}

	it('never lets an older refresh overwrite a newer one when sources resolve out of order', async () => {
		const leaf = makeLeaf();
		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [leaf] });
		const registry = new InProgressRegistry();
		const sources = makeSources();
		const stale = deferred<Array<{ id: string }>>();
		sources.elaboration = vi.fn()
			.mockReturnValueOnce(stale.promise)
			.mockResolvedValue([{ id: 'fresh' }]);
		sources.inProgress = () => registry.snapshot();
		watchInProgress(workspace as unknown as Workspace, sources, registry);

		registry.begin({ id: 'op-1', kind: 'elaboration', label: 'Scanning', cancellable: true });
		registry.end('op-1');
		const latest = refreshUnifiedView(workspace as unknown as Workspace, sources);
		stale.resolve([]);
		await latest;
		await new Promise((r) => setTimeout(r, 0));

		const lastItems = leaf.view.setItems.mock.lastCall?.[0] as Array<{ data: { id: string } }>;
		expect(lastItems.map((i) => i.data.id)).toContain('fresh');
		expect(leaf.view.setInProgress).toHaveBeenLastCalledWith([]);
		expect(sources.elaboration).toHaveBeenCalledTimes(2);
	});

	it('runs a queued refresh even when the running one fails', async () => {
		const leaf = makeLeaf();
		const workspace = makeWorkspace({ [UNIFIED_VIEW_TYPE]: [leaf] });
		const sources = makeSources();
		sources.elaboration = vi.fn()
			.mockRejectedValueOnce(new Error('read failed'))
			.mockResolvedValue([{ id: 'fresh' }]);
		const first = refreshUnifiedView(workspace as unknown as Workspace, sources);
		const second = refreshUnifiedView(workspace as unknown as Workspace, sources);
		await expect(Promise.all([first, second])).resolves.toBeDefined();
		const lastItems = leaf.view.setItems.mock.lastCall?.[0] as Array<{ data: { id: string } }>;
		expect(lastItems.map((i) => i.data.id)).toEqual(['fresh', 'n1', 'd1', 'r1']);
	});
});
