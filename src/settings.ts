// Type-only import (erased at compile time) so settings.ts stays free of a
// runtime cycle with views/types.ts → feature modules → settings.ts.
import type { ProposalKind } from './views/types';
// Type-only import of the exclusion model (centralized in shared/exclusions.ts).
// Erased at compile time; the DEFAULT_SETTINGS values below are plain literals.
import type { ExclusionRule } from './shared/exclusions';

export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';

/** Provider-specific model options. Dropdown values, not free text. */
export const MODEL_OPTIONS: Record<AIProvider, Record<string, string>> = {
	openai: {
		'gpt-4o': 'GPT-4o',
		'gpt-4o-mini': 'GPT-4o Mini',
		'o3': 'o3',
		'o3-mini': 'o3 Mini',
		'o4-mini': 'o4 Mini',
	},
	anthropic: {
		'opus': 'Claude Opus',
		'sonnet': 'Claude Sonnet',
		'haiku': 'Claude Haiku',
	},
	// Stable Gemini model IDs verified against ai.google.dev/gemini-api/docs/models (2026-06).
	gemini: {
		'gemini-3.5-flash': 'Gemini 3.5 Flash',
		'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
		'gemini-2.5-pro': 'Gemini 2.5 Pro',
		'gemini-2.5-flash': 'Gemini 2.5 Flash',
	},
	ollama: {
		'llama3': 'Llama 3',
		'mistral': 'Mistral',
		'codellama': 'Code Llama',
		'gemma': 'Gemma',
	},
};

export interface AISettings {
	provider: AIProvider;
	apiKey: string;
	ollamaEndpoint: string;
	model: string;
	maxTokens: number;
	temperature: number;
}

export interface DetectionSettings {
	minWordThreshold: number;
	detectTodoMarkers: boolean;
	detectEmptySections: boolean;
	detectSparseLinks: boolean;
	excludeTags: string[];
}

export interface ProposalSettings {
	maxProposalsPerNote: number;
	preserveFrontmatter: boolean;
	includeSourceContext: boolean;
}

export interface ElaborationSettings {
	enabled: boolean;
	proposalFolderPath: string;
	scanOnStartup: boolean;
	autoScanInterval: number;
	detection: DetectionSettings;
	proposal: ProposalSettings;
}

export interface PostProcessingSettings {
	enabled: boolean;
	removeFiller: boolean;
	addStructure: boolean;
	extractKeyPoints: boolean;
	customPrompt: string;
}

export interface AudioSettings {
	enabled: boolean;
	transcriptionProvider: 'whisper-api' | 'deepgram' | 'gemini' | 'local-whisper';
	whisperApiKey: string;
	deepgramApiKey: string;
	geminiApiKey: string;
	whisperModel: string;
	localWhisperPath: string;
	language: string;
	postProcessing: PostProcessingSettings;
}

export interface FrameExtractionSettings {
	enabled: boolean;
	intervalSeconds: number;
	visionModel: string;
	maxFrames: number;
}

export interface VideoSettings {
	enabled: boolean;
	ytDlpPath: string;
	ffmpegPath: string;
	tempFolder: string;
	downloadFolder: string;
	embedInNote: boolean;
	frameExtraction: FrameExtractionSettings;
}

export interface ImageSettings {
	enabled: boolean;
	visionModel: string;
	language: string;
	/** Maximum base64 image payload size in MB before auto-downscaling (API limit is 5 MB). */
	maxImageSizeMb: number;
}

export interface EnrichmentWeightSettings {
	sameFolder: number;
	siblingFolder: number;
	cousinFolder: number;
	distantFolder: number;
	decayPerLevel: number;
	minWeight: number;
}

export interface TagVocabularyEntry {
	category: string;
	tags: string[];
	description: string;
}

export interface EnrichmentSettings {
	enabled: boolean;
	autoEnrich: boolean;
	maxTags: number;
	maxInternalLinks: number;
	maxExternalLinks: number;
	maxTopicLinks: number;
	suggestNewNotes: boolean;
	tagVocabulary: TagVocabularyEntry[];
	internalLinkThreshold: number;
	weights: EnrichmentWeightSettings;
	enrichmentFolderPath: string;
	excludeTags: string[];
	relatedNotesHeading: string;
	referencesHeading: string;
}

export interface SummarizeSettings {
	enabled: boolean;
	maxContentLength: number;
	summaryStyle: 'bullets' | 'paragraph' | 'key-points';
	customPrompt: string;
	autoDetectTemplates: boolean;
	excludeTags: string[];
	autoOrganizeOnSummarize: boolean;
}

export interface TidySettings {
	enabled: boolean;
	snapshotFolderPath: string;
}

export interface OrganizeSettings {
	enabled: boolean;
	proposalFolderPath: string;
	snapshotFolderPath: string;
	excludeTags: string[];
	/** Minimum topic confidence required to propose a new directory (0-1). */
	organizeConfidenceThreshold: number;
}

/** Controls how deep dive notes are placed in the folder hierarchy. */
export type DeepDiveNestingMode = 'nested' | 'flat' | 'auto-organize';

export interface DeepDiveSettings {
	enabled: boolean;
	proposalFolderPath: string;
	maxDepth: number;
	qualityThreshold: number;
	maxNotesPerRun: number;
	noteOutputFolder: string;
	/** How child notes are placed: nested under parent, flat in root subfolder, or AI-organized. */
	nestingMode: DeepDiveNestingMode;
	excludeTags: string[];
	autoEnrichOnAccept: boolean;
	autoOrganizeOnAccept: boolean;
}

export interface RemSettings {
	enabled: boolean;
	/** Use AI to find conceptual matches beyond literal title/alias matching. */
	semanticMatching: boolean;
	/** Minimum confidence for semantic matches (0-1). */
	confidenceThreshold: number;
	/** Maximum link candidates per scanned note. */
	maxLinksPerNote: number;
	/** Storage folder for REM proposals. */
	remFolderPath: string;
}

export interface TitleSettings {
	enabled: boolean;
	proposalFolderPath: string;
	checkAfterOperations: boolean;
}

export interface IntakeSettings {
	enabled: boolean;
	intakeFolder: string;
	markProcessed: boolean;
	moveWhenDone?: string;
	/**
	 * Settle window in seconds: processing fires only after a watched note has
	 * had no create/modify events for this whole interval. The per-path timer
	 * resets on every event, so active typing/sync keeps deferring and the
	 * pipeline runs N seconds after the *last* change (#222).
	 */
	settleSeconds: number;
	/**
	 * When true, drop a dated breadcrumb link file each time a processed intake
	 * note is organized out of the intake folder, so the capture leaves a trace
	 * (#224). No move → no breadcrumb.
	 */
	captureLog: boolean;
	/**
	 * Flat subfolder of the intake folder where breadcrumbs are written
	 * (default `_captured`). This subfolder is excluded from the watcher so
	 * breadcrumbs are never re-ingested.
	 */
	captureLogFolder: string;
}

/**
 * Presentation-only UI preferences that persist across sessions but do not
 * affect plugin behavior. Currently tracks the per-section collapse state of
 * the settings tab accordions (#235).
 */
export interface UISettings {
	/**
	 * Maps a settings accordion's section key (e.g. `elaboration`, `audio`) to
	 * its collapsed state. `true` = collapsed (body hidden), `false` = expanded.
	 * A missing key means "use the default", which is collapsed when the
	 * section's feature is disabled and expanded when it is enabled.
	 */
	collapsedSections: Record<string, boolean>;
}

/**
 * First-run onboarding state (#89). Persisted so the welcome experience fires
 * exactly once. Nested as its own group (rather than a bare top-level flag) so
 * future onboarding signals can join it without widening the settings root.
 */
export interface OnboardingSettings {
	/**
	 * Set once the first-run welcome notice has been shown (or silently marked
	 * for an upgrading user who already has saved data). Gates the notice so it
	 * never appears twice.
	 */
	hasSeenWelcome: boolean;
}

/**
 * Per-proposal-type auto-accept flags (#228). When a kind's flag is `true`,
 * every *future* proposal of that kind is accepted automatically as generated
 * (the unedited draft), so it lands accepted — not pending — in the unified
 * view. Already-pending proposals are never touched. Opt-in: default `false`
 * for every kind. Keyed by {@link ProposalKind} so it stays in sync with the
 * set of kinds Synapse can produce.
 */
export type AutoAcceptSettings = Record<ProposalKind, boolean>;

export interface SynapseSettings {
	ai: AISettings;
	elaboration: ElaborationSettings;
	audio: AudioSettings;
	video: VideoSettings;
	image: ImageSettings;
	enrichment: EnrichmentSettings;
	summarize: SummarizeSettings;
	tidy: TidySettings;
	organize: OrganizeSettings;
	deepDive: DeepDiveSettings;
	title: TitleSettings;
	rem: RemSettings;
	intake: IntakeSettings;
	ui: UISettings;
	autoAccept: AutoAcceptSettings;
	onboarding: OnboardingSettings;
	/**
	 * Centralized per-path exclusion list (#307). Each rule names a vault-relative
	 * glob and the features it blocks (or `'all'`). This is the single source of
	 * truth for path-based exclusion across every flow — the legacy per-module
	 * `excludeFolders` fields were folded into this on upgrade. Tag-based
	 * exclusion (`excludeTags`) remains per-module.
	 */
	exclusions: ExclusionRule[];
}

export const DEFAULT_SETTINGS: SynapseSettings = {
	ai: {
		provider: 'openai',
		apiKey: '',
		ollamaEndpoint: 'http://localhost:11434',
		model: 'gpt-4o',
		maxTokens: 2048,
		temperature: 0.7,
	},
	elaboration: {
		enabled: true,
		proposalFolderPath: '.synapse/proposals',
		scanOnStartup: false,
		autoScanInterval: 0,
		detection: {
			minWordThreshold: 50,
			detectTodoMarkers: true,
			detectEmptySections: true,
			detectSparseLinks: true,
			excludeTags: ['no-elaborate'],
		},
		proposal: {
			maxProposalsPerNote: 3,
			preserveFrontmatter: true,
			includeSourceContext: true,
		},
	},
	audio: {
		enabled: true,
		transcriptionProvider: 'whisper-api',
		whisperApiKey: '',
		deepgramApiKey: '',
		geminiApiKey: '',
		whisperModel: 'whisper-1',
		localWhisperPath: '',
		language: '',
		postProcessing: {
			enabled: true,
			removeFiller: true,
			addStructure: true,
			extractKeyPoints: false,
			customPrompt: '',
		},
	},
	video: {
		enabled: true,
		ytDlpPath: 'yt-dlp',
		ffmpegPath: 'ffmpeg',
		tempFolder: '.synapse/temp',
		downloadFolder: 'Media',
		embedInNote: true,
		frameExtraction: {
			enabled: false,
			intervalSeconds: 30,
			visionModel: 'gpt-4o',
			maxFrames: 20,
		},
	},
	image: {
		enabled: true,
		visionModel: '',
		language: '',
		maxImageSizeMb: 5,
	},
	enrichment: {
		enabled: true,
		autoEnrich: true,
		maxTags: 5,
		maxInternalLinks: 15,
		maxExternalLinks: 3,
		maxTopicLinks: 10,
		suggestNewNotes: true,
		tagVocabulary: [
			{ category: 'Status', tags: ['draft', 'todo', 'reference', 'unfinished', 'needs-review', 'archived'], description: 'Workflow state of the note' },
			{ category: 'Type', tags: ['meeting', 'idea', 'project', 'log', 'guide', 'brainstorm'], description: 'What kind of note this is' },
			{ category: 'Source', tags: ['source/video', 'source/audio', 'source/transcript', 'source/article', 'source/book'], description: 'Where the content originated' },
		],
		internalLinkThreshold: 0.3,
		weights: {
			sameFolder: 1.0,
			siblingFolder: 0.8,
			cousinFolder: 0.5,
			distantFolder: 0.2,
			decayPerLevel: 0.15,
			minWeight: 0.1,
		},
		enrichmentFolderPath: '.synapse/enrichments',
		excludeTags: ['no-enrich'],
		relatedNotesHeading: 'Related Notes',
		referencesHeading: 'References',
	},
	summarize: {
		enabled: true,
		maxContentLength: 4000,
		summaryStyle: 'bullets',
		customPrompt: '',
		autoDetectTemplates: true,
		excludeTags: ['no-summarize'],
		autoOrganizeOnSummarize: false,
	},
	tidy: {
		enabled: true,
		snapshotFolderPath: '.synapse/tidy-snapshots',
	},
	organize: {
		enabled: true,
		proposalFolderPath: '.synapse/organize/proposals',
		snapshotFolderPath: '.synapse/organize/snapshots',
		excludeTags: ['no-organize'],
		organizeConfidenceThreshold: 0.9,
	},
	deepDive: {
		enabled: true,
		proposalFolderPath: '.synapse/deep-dive',
		maxDepth: 3,
		qualityThreshold: 0.4,
		maxNotesPerRun: 50,
		noteOutputFolder: 'Deep Dives',
		nestingMode: 'nested',
		excludeTags: ['no-deep-dive'],
		autoEnrichOnAccept: true,
		autoOrganizeOnAccept: false,
	},
	title: {
		enabled: true,
		proposalFolderPath: '.synapse/title-proposals',
		checkAfterOperations: true,
	},
	rem: {
		enabled: true,
		semanticMatching: false,
		confidenceThreshold: 0.5,
		maxLinksPerNote: 20,
		remFolderPath: '.synapse/rem',
	},
	intake: {
		enabled: true,
		intakeFolder: 'Inbox',
		markProcessed: true,
		moveWhenDone: '',
		settleSeconds: 5,
		captureLog: true,
		captureLogFolder: '_captured',
	},
	ui: {
		collapsedSections: {},
	},
	autoAccept: {
		elaboration: false,
		enrichment: false,
		organize: false,
		'deep-dive': false,
		title: false,
		rem: false,
	},
	onboarding: {
		hasSeenWelcome: false,
	},
	// Centralized path exclusions (#307). `.synapse` (plugin data) and
	// `templates` are protected from EVERY flow out of the box; users add their
	// own rules (optionally scoped to specific features) via the Exclusions
	// settings section. Stored in canonical `/**` form.
	exclusions: [
		{ pattern: '.synapse/**', features: 'all' },
		{ pattern: 'templates/**', features: 'all' },
	],
};
