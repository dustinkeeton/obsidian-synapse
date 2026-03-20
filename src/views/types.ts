import type { Proposal } from '../elaboration';
import type { AcceptedItems, EnrichmentProposal } from '../enrichment';
import type { OrganizeProposal } from '../organize';
import type { DeepDiveProposal } from '../deep-dive';
import type { TitleProposal } from '../title';
import type { RemProposal } from '../rem';

/** Wrapper to unify elaboration, enrichment, organize, deep-dive, title, and REM proposals in one list. */
export type UnifiedItem =
	| { kind: 'elaboration'; data: Proposal }
	| { kind: 'enrichment'; data: EnrichmentProposal }
	| { kind: 'organize'; data: OrganizeProposal }
	| { kind: 'deep-dive'; data: DeepDiveProposal }
	| { kind: 'title'; data: TitleProposal }
	| { kind: 'rem'; data: RemProposal };

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
