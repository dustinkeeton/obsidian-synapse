import { acceptNotApplied } from '../shared';
import type { FeatureModules } from '../modules';
import type { ProposalKind } from '../views';
import type { ProposalAdapter } from './types';

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** `items` must be a non-empty subset of what the proposal offers. */
function invalidItems(items: string[] | undefined, offered: string[]): string | null {
	if (items === undefined) return null;
	if (!Array.isArray(items) || items.length === 0) return 'items must list at least one item';
	const unknown = items.filter((item) => !offered.includes(item));
	return unknown.length > 0 ? `Unknown items: ${unknown.join(', ')}` : null;
}

export function buildProposalAdapters(modules: FeatureModules): Record<ProposalKind, ProposalAdapter> {
	const { elaboration, enrichment, organize, deepDive, title, rem, illustrate } = modules;

	const elaborationAdapter: ProposalAdapter = {
		list: async () => (await elaboration.getPendingProposals()).map((p) => ({
			kind: 'elaboration', id: p.id, notePath: p.sourceNotePath, createdAt: p.createdAt, summary: 'Rewrite the note body',
			...(p.generation ? { generation: p.generation } : {}),
		})),
		accept: async (id, options) => {
			const result = await elaboration.acceptProposal(id, options.content, { onStale: options.force ? 'replace' : 'skip' });
			return result.status === 'conflict' ? { ...result, reason: `${result.reason ?? 'The note changed'} (pass force: true to replace it)` } : result;
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
		accept: (id) => enrichment.acceptProposal(id),
		reject: (id) => enrichment.rejectFromView(id),
	};

	const organizeAdapter: ProposalAdapter = {
		list: async () => (await organize.getPendingProposals()).map((p) => ({
			kind: 'organize', id: p.id, notePath: p.sourceNotePath, createdAt: p.createdAt, summary: `Move to ${p.proposedDirectory}`,
		})),
		accept: (id) => organize.acceptProposal(id),
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
		accept: (id) => deepDive.acceptProposal(id),
		reject: (id) => deepDive.rejectProposal(id),
	};

	const titleAdapter: ProposalAdapter = {
		list: async () => (await title.getPendingProposals()).map((p) => ({
			kind: 'title', id: p.id, notePath: p.sourceNotePath, createdAt: p.createdAt, summary: `Rename to "${p.proposedTitle}"`,
		})),
		accept: async (id, options) => {
			const result = await title.acceptProposal(id, options.resolution ? { resolution: options.resolution } : undefined);
			return result.status === 'conflict' ? { ...result, reason: `${result.reason ?? 'The target exists'}; pass resolution "iterate" or "merge"` } : result;
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
			if (!proposal) return acceptNotApplied('skipped', 'Proposal not found or not pending');
			const offered = proposal.candidates.map((c) => c.matchedText);
			const bad = invalidItems(options.items, offered);
			if (bad) return acceptNotApplied('skipped', bad);
			return rem.acceptProposal(id, options.items ?? offered);
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
			if (!proposal) return acceptNotApplied('skipped', 'Proposal not found or not pending');
			const offered = proposal.items.map((item) => item.id);
			const bad = invalidItems(options.items, offered);
			if (bad) return acceptNotApplied('skipped', bad);
			return illustrate.acceptProposal(id, options.items ?? offered);
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
