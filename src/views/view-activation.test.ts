import { describe, it, expect, vi } from 'vitest';
import { activateUnifiedView, activateSynapseActionsView, refreshUnifiedView } from './view-activation';
import type { UnifiedViewSources } from './view-activation';
import { UNIFIED_VIEW_TYPE } from './unified-proposal-view';
import { SYNAPSE_ACTIONS_VIEW_TYPE } from './synapse-actions-view';
import type { Workspace } from 'obsidian';

function makeSources(): UnifiedViewSources {
	return {
		elaboration: vi.fn().mockResolvedValue([{ id: 'e1' }]),
		enrichment: vi.fn().mockResolvedValue([{ id: 'n1' }]),
		organize: vi.fn().mockResolvedValue([]),
		'deep-dive': vi.fn().mockResolvedValue([{ id: 'd1' }]),
		title: vi.fn().mockResolvedValue([]),
		rem: vi.fn().mockResolvedValue([{ id: 'r1' }]),
		checkpoints: vi.fn().mockResolvedValue([{ id: 'cp1' }]),
	};
}

function makeLeaf() {
	return {
		view: { setItems: vi.fn(), setCheckpoints: vi.fn() },
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
