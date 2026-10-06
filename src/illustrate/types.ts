import type { RegionLocator, ResolvedInsertion } from '../shared/insertion-point';

/** Visual kinds the analyzer can propose for one spot in a note. */
export type IllustrateSpotKind = 'photo' | 'diagram' | 'chart';

/** Keyless repositories the user can toggle in settings. */
export type RepositoryProviderId = 'wikimedia' | 'openverse';
/** `'source'` serves images from the material an action acted on (#213); never user-toggled. */
export type MediaProviderId = RepositoryProviderId | 'source';

/** Actions whose completion can chain an illustrate pass. */
export type IllustrateRunAfterKey = 'elaboration' | 'transcription' | 'summarize' | 'enrichment' | 'deepDive';

/** A real, licensed image found by a provider; every field is captured at search time. */
export interface MediaCandidate {
	provider: MediaProviderId;
	title: string;
	/** Direct image URL used for download or URL-embed. */
	fileUrl: string;
	/** Smaller preview URL for the sidebar (never downloaded). */
	thumbnailUrl: string;
	/** Human-facing source page for attribution. */
	pageUrl: string;
	/** Normalized short license name (see license.ts), e.g. `CC BY-SA`. */
	license: string;
	licenseUrl: string;
	attribution: string;
	mimeType?: string;
}

export interface MediaSearchOptions {
	limit: number;
}

/** Provider contract kept small so other media sources can plug in. */
export interface MediaProvider {
	readonly id: MediaProviderId;
	search(query: string, opts: MediaSearchOptions): Promise<MediaCandidate[]>;
}

/** Numeric series the AI extracted from the note itself; never fetched externally. */
export interface ChartData {
	title: string;
	xLabels: string[];
	series: Array<{ label?: string; values: number[] }>;
	yLabel?: string;
}

interface SpotBase {
	/** Heading text or the opening words of the paragraph the visual belongs under. */
	anchor: string;
	caption: string;
	rationale: string;
}

export type IllustrateSpot =
	| (SpotBase & { kind: 'photo'; query: string })
	| (SpotBase & { kind: 'diagram'; mermaid: string })
	| (SpotBase & { kind: 'chart'; chart: ChartData });

interface ItemBase {
	id: string;
	anchor: string;
	caption: string;
	rationale: string;
	/** Preview resolved at proposal time; accept re-resolves against the live note. Absent on pre-placement proposals. */
	placement?: ResolvedInsertion;
	/** Callout the visual belongs inside (post-op runs); absent = whole note, never inside containers. */
	region?: RegionLocator;
}

export type IllustrateItem =
	| (ItemBase & { kind: 'photo'; candidate: MediaCandidate })
	| (ItemBase & { kind: 'diagram' | 'chart'; mermaid: string });

export type IllustrateProposalStatus = 'pending' | 'accepted' | 'partially-accepted' | 'rejected';

export interface IllustrateProposal {
	id: string;
	sourceNotePath: string;
	createdAt: string;
	items: IllustrateItem[];
	status: IllustrateProposalStatus;
	acceptedItemIds?: string[];
}

export interface IllustrateSettings {
	enabled: boolean;
	providers: Record<RepositoryProviderId, boolean>;
	/** Opt-in: AI-written Mermaid diagrams and note-data charts; off = photo spots only. */
	mermaid: boolean;
	/** Chain an illustrate pass after these actions complete (post-op hook). */
	runAfter: Record<IllustrateRunAfterKey, boolean>;
	/** Fetch pages linked from the acted-on note for source images: one request per page. */
	fetchLinkedPages: boolean;
	maxLinkedPagesPerNote: number;
	maxItemsPerNote: number;
	/** Allow-list of normalized license names; candidates outside it are dropped. */
	licenseFilter: string[];
	/** Download accepted photos into the vault; off = embed the remote URL. */
	preferDownload: boolean;
	proposalFolderPath: string;
	excludeTags: string[];
}
