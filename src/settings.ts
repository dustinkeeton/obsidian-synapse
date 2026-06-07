export type AIProvider = 'openai' | 'anthropic' | 'ollama';

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
	excludeFolders: string[];
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
	transcriptionProvider: 'whisper-api' | 'deepgram' | 'local-whisper';
	whisperApiKey: string;
	deepgramApiKey: string;
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
	excludeFolders: string[];
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
	excludeFolders: string[];
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
	excludeFolders: string[];
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
	excludeFolders: string[];
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
}

export const DEFAULT_SETTINGS: SynapseSettings = {
	ai: {
		provider: 'openai',
		apiKey: '',
		ollamaEndpoint: 'http://localhost:11434',
		model: 'gpt-4o',
		maxTokens: 2048,
		temperature: 0.7,
	} as AISettings,
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
			excludeFolders: ['templates', '.synapse'],
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
		excludeFolders: ['templates', '.synapse'],
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
		excludeFolders: ['templates', '.synapse'],
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
		excludeFolders: ['templates', '.synapse'],
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
		excludeFolders: ['templates', '.synapse'],
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
};
