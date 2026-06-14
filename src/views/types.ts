import type { Proposal } from '../elaboration';
import type { AcceptedItems, EnrichmentProposal } from '../enrichment';
import type { OrganizeProposal } from '../organize';
import type { DeepDiveProposal } from '../deep-dive';
import type { TitleProposal } from '../title';
import type { RemProposal } from '../rem';

/**
 * The single source of truth for the set of proposal kinds Synapse generates.
 *
 * Settings (`autoAccept`), defaults, and the settings UI all iterate this list
 * so they stay in lockstep with {@link UnifiedItem}. A compile-time check below
 * asserts this tuple is exactly the union of {@link UnifiedItem}['kind'] — if a
 * new kind is added to one without the other, the build fails.
 */
export const PROPOSAL_KINDS = [
	'elaboration',
	'enrichment',
	'organize',
	'deep-dive',
	'title',
	'rem',
] as const;

/** Wrapper to unify elaboration, enrichment, organize, deep-dive, title, and REM proposals in one list. */
export type UnifiedItem =
	| { kind: 'elaboration'; data: Proposal }
	| { kind: 'enrichment'; data: EnrichmentProposal }
	| { kind: 'organize'; data: OrganizeProposal }
	| { kind: 'deep-dive'; data: DeepDiveProposal }
	| { kind: 'title'; data: TitleProposal }
	| { kind: 'rem'; data: RemProposal };

/** A single proposal kind — derived from {@link PROPOSAL_KINDS}, equal to {@link UnifiedItem}['kind']. */
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

// Compile-time guard: PROPOSAL_KINDS must cover exactly UnifiedItem['kind'].
// Two separate, distinct assertions (not an intersection — that would make the
// constituents duplicate, since both conditionals resolve to `true`). Each
// `const ... : true = ...` fails to type-check if its direction diverges: the
// first if a UnifiedItem kind is missing from PROPOSAL_KINDS, the second if
// PROPOSAL_KINDS lists a kind not in UnifiedItem.
type _AssertKindsCoverUnion = UnifiedItem['kind'] extends ProposalKind ? true : never;
type _AssertUnionCoversKinds = ProposalKind extends UnifiedItem['kind'] ? true : never;
const _kindsCoverUnion: _AssertKindsCoverUnion = true;
const _unionCoversKinds: _AssertUnionCoversKinds = true;
void _kindsCoverUnion;
void _unionCoversKinds;

export interface UnifiedViewCallbacks {
	// Elaboration
	onElaborationAccept: (id: string, editedContent: string) => Promise<void>;
	onElaborationReject: (id: string) => Promise<void>;
	// Enrichment
	onEnrichmentAcceptSelected: (id: string, accepted: AcceptedItems) => Promise<void>;
	onEnrichmentReject: (id: string) => Promise<void>;
	// Organize
	onOrganizeAccept: (id: string) => Promise<void>;
	onOrganizeReject: (id: string) => Promise<void>;
	// Deep Dive
	onDeepDiveAccept: (id: string) => Promise<void>;
	onDeepDiveReject: (id: string) => Promise<void>;
	// Title
	onTitleAccept: (id: string) => Promise<void>;
	onTitleReject: (id: string) => Promise<void>;
	// REM
	onRemAcceptSelected: (id: string, acceptedMatchTexts: string[]) => Promise<void>;
	onRemReject: (id: string) => Promise<void>;
	// Checkpoints
	onCheckpointDiscard: (id: string) => Promise<void>;
	onCheckpointResume: (id: string) => Promise<void>;
}
