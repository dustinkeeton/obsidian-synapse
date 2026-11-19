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

const APPLIED_STATUSES = new Set(['accepted', 'partially-accepted']);

/** For modules whose accept returns nothing: applied only when the stored status says so (a module may reject instead). */
async function appliedFromStatus(
	getProposal: (id: string) => Promise<{ status: string } | null>,
	id: string,
	written: string[]
): Promise<AcceptOutcome> {
	const status = (await getProposal(id))?.status;
	if (status && APPLIED_STATUSES.has(status)) return { applied: true, written };
	return { applied: false, written: [], error: `Proposal was not applied (status: ${status ?? 'missing'})` };
}

/** `items` must be a non-empty subset of what the proposal offers. */
function invalidItems(items: string[] | undefined, offered: string[]): string | null {
	if (items === undefined) return null;
	if (!Array.isArray(items) || items.length === 0) return 'items must list at least one item';
	const unknown = items.filter((item) => !offered.includes(item));
	return unknown.length > 0 ? `Unknown items: ${unknown.join(', ')}` : null;
}

function noteExists(app: App, path: string): boolean {
	return app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
}

export function buildProposalAdapters(app: App, modules: FeatureModules): Record<ProposalKind, ProposalAdapter> {
	const { elaboration, enrichment, organize, deepDive, title, rem, illustrate } = modules;

	const elaborationAdapter: ProposalAdapter = {
		list: async () => (await elaboration.getPendingProposals()).map((p) => ({
			kind: 'elaboration', id: p.id, notePath: p.sourceNotePath, createdAt: p.createdAt, summary: 'Rewrite the note body',
			...(p.generation ? { generation: p.generation } : {}),
		})),
		accept: async (id, options) => {
			const proposal = (await elaboration.getPendingProposals()).find((p) => p.id === id);
			if (!proposal) return { applied: false, written: [], error: 'Proposal not found or not pending' };
			if (!noteExists(app, proposal.sourceNotePath)) return { applied: false, written: [], error: `Source note no longer exists: ${proposal.sourceNotePath}` };
			const applied = await elaboration.acceptProposal(id, options.content, { onStale: options.force ? 'replace' : 'skip' });
			if (applied) return { applied, written: [proposal.sourceNotePath] };
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
			return appliedFromStatus((pid) => enrichment.getProposal(pid), id, proposal ? [proposal.sourceNotePath] : []);
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
			return appliedFromStatus((pid) => organize.getProposal(pid), id, moved && noteExists(app, moved) ? [moved] : []);
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
			...(p.generation ? { generation: p.generation } : {}),
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
			const offered = proposal.candidates.map((c) => c.matchedText);
			const bad = invalidItems(options.items, offered);
			if (bad) return { applied: false, written: [], error: bad };
			await rem.acceptProposal(id, options.items ?? offered);
			return appliedFromStatus((pid) => rem.getProposal(pid), id, [proposal.sourceNotePath]);
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
			const offered = proposal.items.map((item) => item.id);
			const bad = invalidItems(options.items, offered);
			if (bad) return { applied: false, written: [], error: bad };
			await illustrate.acceptProposal(id, options.items ?? offered);
			return appliedFromStatus((pid) => illustrate.getProposal(pid), id, [proposal.sourceNotePath]);
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
