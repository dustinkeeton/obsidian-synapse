import { normalizePath, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { FeatureModules } from '../modules';
import type { ProposalKind } from '../views';
import type { ApiAcceptOptions, ApiProposal } from './types';

/** What one accept did; `applied: false` carries the reason in `error`. */
export interface AcceptOutcome {
	applied: boolean;
	written: string[];
	error?: string;
}

/** Per-kind bridge from the public verbs to a module's proposal methods. */
export interface ProposalAdapter {
	list(): Promise<ApiProposal[]>;
	accept(id: string, options: ApiAcceptOptions): Promise<AcceptOutcome>;
	reject(id: string): Promise<void>;
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** For modules whose accept returns nothing: applied when the proposal left the pending list. */
async function appliedUnlessPending(adapter: Pick<ProposalAdapter, 'list'>, id: string, written: string[]): Promise<AcceptOutcome> {
	const stillPending = (await adapter.list()).some((p) => p.id === id);
	return stillPending
		? { applied: false, written: [], error: 'Proposal was not applied; it is still pending' }
		: { applied: true, written };
}

export function buildProposalAdapters(app: App, modules: FeatureModules): Record<ProposalKind, ProposalAdapter> {
	const { elaboration, enrichment, organize, deepDive, title, rem, illustrate } = modules;

	const elaborationAdapter: ProposalAdapter = {
		list: async () => (await elaboration.getPendingProposals()).map((p) => ({
			kind: 'elaboration', id: p.id, notePath: p.sourceNotePath, createdAt: p.createdAt, summary: 'Rewrite the note body',
		})),
		accept: async (id, options) => {
			const proposal = (await elaboration.getPendingProposals()).find((p) => p.id === id);
			const applied = await elaboration.acceptProposal(id, options.content, { onStale: options.force ? 'replace' : 'skip' });
			if (applied) return { applied, written: proposal ? [proposal.sourceNotePath] : [] };
			return { applied, written: [], error: 'Not applied: the note changed since the proposal was generated (pass force: true to replace it)' };
		},
		reject: (id) => elaboration.rejectProposal(id),
	};

	const enrichmentAdapter: ProposalAdapter = {
		list: async () => (await enrichment.getPendingProposals()).map((p) => ({
			kind: 'enrichment',
			id: p.id,
			notePath: p.sourceNotePath,
			createdAt: p.createdAt,
			summary: [
				plural(p.result.tags.length, 'tag'),
				plural(p.result.internalLinks.length + p.result.externalLinks.length, 'link'),
				`${p.result.frontmatter.length} frontmatter field${p.result.frontmatter.length === 1 ? '' : 's'}`,
			].join(', '),
		})),
		accept: async (id) => {
			const proposal = (await enrichment.getPendingProposals()).find((p) => p.id === id);
			await enrichment.acceptSelectedFromView(id);
			return appliedUnlessPending(enrichmentAdapter, id, proposal ? [proposal.sourceNotePath] : []);
		},
		reject: (id) => enrichment.rejectFromView(id),
	};

	const organizeAdapter: ProposalAdapter = {
		list: async () => (await organize.getPendingProposals()).map((p) => ({
			kind: 'organize', id: p.id, notePath: p.sourceNotePath, createdAt: p.createdAt, summary: `Move to ${p.proposedDirectory}`,
		})),
		accept: async (id) => {
			const proposal = (await organize.getPendingProposals()).find((p) => p.id === id);
			await organize.acceptProposal(id);
			const moved = proposal ? normalizePath(`${proposal.proposedDirectory}/${proposal.sourceNotePath.split('/').pop() ?? ''}`) : null;
			return appliedUnlessPending(organizeAdapter, id, moved && app.vault.getAbstractFileByPath(moved) instanceof TFile ? [moved] : []);
		},
		reject: (id) => organize.rejectProposal(id),
	};

	const deepDiveAdapter: ProposalAdapter = {
		list: async () => (await deepDive.getPendingProposals()).map((p) => ({
			kind: 'deep-dive',
			id: p.id,
			notePath: p.proposedPath,
			sourceNotePath: p.sourceNotePath,
			createdAt: p.createdAt,
			summary: `Create note on "${p.topic.title}" (depth ${p.depth})`,
		})),
		accept: async (id) => {
			const proposal = (await deepDive.getPendingProposals()).find((p) => p.id === id);
			const applied = await deepDive.acceptProposal(id);
			return applied
				? { applied, written: proposal ? [proposal.proposedPath] : [] }
				: { applied, written: [], error: 'Proposal not found or not pending' };
		},
		reject: (id) => deepDive.rejectProposal(id),
	};

	const titleAdapter: ProposalAdapter = {
		list: async () => (await title.getPendingProposals()).map((p) => ({
			kind: 'title', id: p.id, notePath: p.sourceNotePath, createdAt: p.createdAt, summary: `Rename to "${p.proposedTitle}"`,
		})),
		accept: async (id, options) => {
			const outcome = await title.acceptProposal(id, options.resolution ? { resolution: options.resolution } : undefined);
			switch (outcome.status) {
				case 'renamed': return { applied: true, written: [outcome.path] };
				case 'merged': return { applied: true, written: [outcome.into] };
				case 'conflict': return { applied: false, written: [], error: `"${outcome.target}" already exists; pass resolution "iterate" or "merge"` };
				default: return { applied: false, written: [], error: 'Proposal not found, not pending, or its note is gone' };
			}
		},
		reject: (id) => title.rejectProposal(id),
	};

	const remAdapter: ProposalAdapter = {
		list: async () => (await rem.getPendingProposals()).map((p) => ({
			kind: 'rem',
			id: p.id,
			notePath: p.sourceNotePath,
			createdAt: p.createdAt,
			summary: plural(p.candidates.length, 'link'),
			items: p.candidates.map((c) => c.matchedText),
		})),
		accept: async (id, options) => {
			const proposal = (await rem.getPendingProposals()).find((p) => p.id === id);
			if (!proposal) return { applied: false, written: [], error: 'Proposal not found or not pending' };
			await rem.acceptProposal(id, options.items ?? proposal.candidates.map((c) => c.matchedText));
			return appliedUnlessPending(remAdapter, id, [proposal.sourceNotePath]);
		},
		reject: (id) => rem.rejectProposal(id),
	};

	const illustrateAdapter: ProposalAdapter = {
		list: async () => (await illustrate.getPendingProposals()).map((p) => ({
			kind: 'illustrate',
			id: p.id,
			notePath: p.sourceNotePath,
			createdAt: p.createdAt,
			summary: plural(p.items.length, 'item'),
			items: p.items.map((item) => item.id),
		})),
		accept: async (id, options) => {
			const proposal = (await illustrate.getPendingProposals()).find((p) => p.id === id);
			if (!proposal) return { applied: false, written: [], error: 'Proposal not found or not pending' };
			await illustrate.acceptProposal(id, options.items ?? proposal.items.map((item) => item.id));
			return appliedUnlessPending(illustrateAdapter, id, [proposal.sourceNotePath]);
		},
		reject: (id) => illustrate.rejectProposal(id),
	};

	return {
		elaboration: elaborationAdapter,
		enrichment: enrichmentAdapter,
		organize: organizeAdapter,
		'deep-dive': deepDiveAdapter,
		title: titleAdapter,
		rem: remAdapter,
		illustrate: illustrateAdapter,
	};
}
