/** Configuration for the folder proximity weight algorithm. */
export interface WeightConfig {
	/** Weight for files in the same folder (default: 1.0) */
	sameFolder: number;
	/** Weight for files in sibling folders — shared parent (default: 0.8) */
	siblingFolder: number;
	/** Weight for files at grandparent level (default: 0.5) */
	cousinFolder: number;
	/** Weight for everything else (default: 0.2) */
	distantFolder: number;
	/** Reduction per additional folder hop (default: 0.15) */
	decayPerLevel: number;
	/** Floor — distant files are never invisible (default: 0.1) */
	minWeight: number;
}

export interface TagCandidate {
	tag: string;
	/** Vocabulary category (e.g., "Status", "Type", "Source") */
	category: string;
	/** Classification confidence from AI (0-1) */
	confidence: number;
	/** Unweighted global frequency across the vault */
	rawScore: number;
	/** After proximity weighting */
	weightedScore: number;
	/** File paths that contributed this tag */
	sources: string[];
}

export interface TagVocabularyEntry {
	category: string;
	tags: string[];
	description: string;
}

export interface InternalLinkCandidate {
	targetPath: string;
	displayText: string;
	relevanceScore: number;
	/** Human-readable explanation, e.g., "shares 3 tags" */
	reason: string;
}

export interface ExternalLinkCandidate {
	url: string;
	title: string;
	reason: string;
}

export interface FrontmatterEnrichment {
	key: string;
	value: string | string[];
	action: 'add' | 'merge';
}

export interface EnrichmentResult {
	tags: TagCandidate[];
	internalLinks: InternalLinkCandidate[];
	externalLinks: ExternalLinkCandidate[];
	frontmatter: FrontmatterEnrichment[];
}

export type EnrichmentTrigger = 'elaboration' | 'transcription' | 'summarization' | 'manual';

export type EnrichmentStatus =
	| 'pending'
	| 'accepted'
	| 'partially-accepted'
	| 'rejected';

export interface AcceptedItems {
	tags: string[];
	internalLinks: string[];
	externalLinks: string[];
	frontmatter: string[];
}

export interface EnrichmentProposal {
	id: string;
	sourceNotePath: string;
	createdAt: string;
	triggerSource: EnrichmentTrigger;
	result: EnrichmentResult;
	status: EnrichmentStatus;
	acceptedItems?: AcceptedItems;
}

/** Snapshot of vault-wide tag usage built from MetadataCache. */
export interface TagIndex {
	/** tag → { count, files that use it } */
	tags: Map<string, { count: number; files: string[] }>;
}

/** Snapshot of vault-wide link adjacency. */
export interface LinkGraph {
	/** sourcePath → set of destination paths */
	outgoing: Map<string, Set<string>>;
	/** destPath → set of source paths (reverse index) */
	incoming: Map<string, Set<string>>;
}
