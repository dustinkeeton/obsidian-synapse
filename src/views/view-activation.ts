import type { Workspace, WorkspaceLeaf } from 'obsidian';
import { fireAndForget } from '../shared';
import type { Checkpoint, InProgressEntry, InProgressRegistry } from '../shared';
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

/** Pending-proposal readers, one per proposal kind, plus the checkpoint banner and in-progress sources. */
export interface UnifiedViewSources {
	elaboration: () => Promise<Proposal[]>;
	enrichment: () => Promise<EnrichmentProposal[]>;
	organize: () => Promise<OrganizeProposal[]>;
	'deep-dive': () => Promise<DeepDiveProposal[]>;
	title: () => Promise<TitleProposal[]>;
	rem: () => Promise<RemProposal[]>;
	illustrate: () => Promise<IllustrateProposal[]>;
	checkpoints: () => Promise<Checkpoint[]>;
	inProgress: () => InProgressEntry[];
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
	return typeof candidate?.setItems === 'function'
		&& typeof candidate.setCheckpoints === 'function'
		&& typeof candidate.setInProgress === 'function';
}

/** Load a deferred leaf so its real view exists; the test mock lacks the API, so both members are optional reads. */
async function ensureLoaded(leaf: WorkspaceLeaf): Promise<void> {
	const deferrable = leaf as Partial<Pick<WorkspaceLeaf, 'isDeferred' | 'loadIfDeferred'>>;
	if (deferrable.isDeferred && typeof deferrable.loadIfDeferred === 'function') await deferrable.loadIfDeferred();
}

interface RefreshState {
	running: Promise<void> | null;
	rerun: boolean;
	sources: UnifiedViewSources;
}

const refreshStates = new WeakMap<Workspace, RefreshState>();

/**
 * Push every pending proposal, incomplete checkpoint and running operation into each open unified view; no-op when none is open.
 * Calls are serialized per workspace: a request made while one runs schedules a single rerun, and every caller resolves after it.
 */
export function refreshUnifiedView(workspace: Workspace, sources: UnifiedViewSources): Promise<void> {
	let state = refreshStates.get(workspace);
	if (!state) {
		state = { running: null, rerun: false, sources };
		refreshStates.set(workspace, state);
	}
	state.sources = sources;
	if (state.running) {
		state.rerun = true;
		return state.running;
	}
	const current = state;
	current.running = (async () => {
		let failure: { error: unknown } | null = null;
		try {
			do {
				current.rerun = false;
				try {
					await refreshOnce(workspace, current.sources);
					failure = null;
				} catch (error) {
					failure = { error };
				}
			} while (current.rerun);
		} finally {
			current.running = null;
		}
		if (failure) throw failure.error;
	})();
	return current.running;
}

async function refreshOnce(workspace: Workspace, sources: UnifiedViewSources): Promise<void> {
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
	}
	// Snapshot after every await so a row removed mid-load lands in the same render as its proposals.
	const inProgress = sources.inProgress();
	for (const leaf of leaves) {
		const view: unknown = leaf.view;
		if (!isUnifiedProposalView(view)) continue;
		view.setItems(items);
		view.setCheckpoints(checkpoints);
		view.setInProgress(inProgress);
	}
}

/**
 * Keep open unified views in sync with the in-progress registry: a start or end reloads every
 * source (so finished rows hand off to their proposals in one render); a progress tick only
 * re-renders the in-progress rows. Returns the unsubscribe function.
 */
export function watchInProgress(workspace: Workspace, sources: UnifiedViewSources, registry: InProgressRegistry): () => void {
	let membership = membershipKey(registry.snapshot());
	return registry.subscribe((entries) => {
		const next = membershipKey(entries);
		if (next !== membership) {
			membership = next;
			fireAndForget(refreshUnifiedView(workspace, sources), 'Refresh proposal view', { background: true });
			return;
		}
		for (const leaf of workspace.getLeavesOfType(UNIFIED_VIEW_TYPE)) {
			const view: unknown = leaf.view;
			if (isUnifiedProposalView(view)) view.setInProgress([...entries]);
		}
	});
}

function membershipKey(entries: readonly InProgressEntry[]): string {
	return entries.map((e) => e.id).join('\n');
}
