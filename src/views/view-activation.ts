import type { Workspace, WorkspaceLeaf } from 'obsidian';
import { fireAndForget } from '../shared';
import type { Checkpoint } from '../shared';
import type { Proposal } from '../elaboration';
import type { EnrichmentProposal } from '../enrichment';
import type { OrganizeProposal } from '../organize';
import type { DeepDiveProposal } from '../deep-dive';
import type { TitleProposal } from '../title';
import type { RemProposal } from '../rem';
import type { IllustrateProposal } from '../illustrate';
import { UNIFIED_VIEW_TYPE, UnifiedProposalView } from './unified-proposal-view';
import { SYNAPSE_ACTIONS_VIEW_TYPE } from './synapse-actions-view';
import type { UnifiedItem } from './types';

/** Pending-proposal readers, one per proposal kind, plus the checkpoint banner source. */
export interface UnifiedViewSources {
	elaboration: () => Promise<Proposal[]>;
	enrichment: () => Promise<EnrichmentProposal[]>;
	organize: () => Promise<OrganizeProposal[]>;
	'deep-dive': () => Promise<DeepDiveProposal[]>;
	title: () => Promise<TitleProposal[]>;
	rem: () => Promise<RemProposal[]>;
	illustrate: () => Promise<IllustrateProposal[]>;
	checkpoints: () => Promise<Checkpoint[]>;
}

/** Reveal (creating in the right sidebar if needed) the single leaf of `viewType`; returns it, or null when no right leaf exists. */
async function revealSidebarView(workspace: Workspace, viewType: string, label: string) {
	let leaf = workspace.getLeavesOfType(viewType)[0];
	if (!leaf) {
		const rightLeaf = workspace.getRightLeaf(false);
		if (!rightLeaf) return null;
		leaf = rightLeaf;
		await leaf.setViewState({ type: viewType, active: true });
	}
	fireAndForget(workspace.revealLeaf(leaf), label, { background: true });
	return leaf;
}

export async function activateUnifiedView(workspace: Workspace, sources: UnifiedViewSources): Promise<void> {
	const leaf = await revealSidebarView(workspace, UNIFIED_VIEW_TYPE, 'Reveal proposal view');
	if (!leaf) return;
	await refreshUnifiedView(workspace, sources);
}

export async function activateSynapseActionsView(workspace: Workspace): Promise<void> {
	await revealSidebarView(workspace, SYNAPSE_ACTIONS_VIEW_TYPE, 'Reveal Synapse actions');
}

/** Obsidian >= 1.7.2 parks background leaves behind a DeferredView without the view's methods; duck-type rather than trust the leaf type. */
function isUnifiedProposalView(view: unknown): view is UnifiedProposalView {
	const candidate = view as Partial<UnifiedProposalView> | null;
	return typeof candidate?.setItems === 'function' && typeof candidate.setCheckpoints === 'function';
}

/** Load a deferred leaf so its real view exists; the test mock lacks the API, so both members are optional reads. */
async function ensureLoaded(leaf: WorkspaceLeaf): Promise<void> {
	const deferrable = leaf as Partial<Pick<WorkspaceLeaf, 'isDeferred' | 'loadIfDeferred'>>;
	if (deferrable.isDeferred && typeof deferrable.loadIfDeferred === 'function') await deferrable.loadIfDeferred();
}

/** Push every pending proposal and incomplete checkpoint into each open unified view; no-op when none is open. */
export async function refreshUnifiedView(workspace: Workspace, sources: UnifiedViewSources): Promise<void> {
	const leaves = workspace.getLeavesOfType(UNIFIED_VIEW_TYPE);
	if (leaves.length === 0) return;

	const items: UnifiedItem[] = [];
	for (const p of await sources.elaboration()) items.push({ kind: 'elaboration', data: p });
	for (const p of await sources.enrichment()) items.push({ kind: 'enrichment', data: p });
	for (const p of await sources.organize()) items.push({ kind: 'organize', data: p });
	for (const p of await sources['deep-dive']()) items.push({ kind: 'deep-dive', data: p });
	for (const p of await sources.title()) items.push({ kind: 'title', data: p });
	for (const p of await sources.rem()) items.push({ kind: 'rem', data: p });
	for (const p of await sources.illustrate()) items.push({ kind: 'illustrate', data: p });

	const checkpoints = await sources.checkpoints();

	for (const leaf of leaves) {
		await ensureLoaded(leaf);
		const view: unknown = leaf.view;
		if (!isUnifiedProposalView(view)) continue;
		view.setItems(items);
		view.setCheckpoints(checkpoints);
	}
}
