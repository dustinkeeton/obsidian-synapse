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

export interface AudioOutputSettings {
	folder: string;
	fileNameTemplate: string;
	appendToExisting: boolean;
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
	output: AudioOutputSettings;
}

export interface FrameExtractionSettings {
	enabled: boolean;
	intervalSeconds: number;
	visionModel: string;
	maxFrames: number;
}

export interface VideoOutputSettings {
	folder: string;
	fileNameTemplate: string;
	includeVideoMetadata: boolean;
}

export interface VideoSettings {
	enabled: boolean;
	ytDlpPath: string;
	ffmpegPath: string;
	tempFolder: string;
	supportedPlatforms: {
		youtube: boolean;
		tiktok: boolean;
	};
	frameExtraction: FrameExtractionSettings;
	output: VideoOutputSettings;
}

export interface AutoNotesSettings {
	ai: AISettings;
	elaboration: ElaborationSettings;
	audio: AudioSettings;
	video: VideoSettings;
}

export const DEFAULT_SETTINGS: AutoNotesSettings = {
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
		proposalFolderPath: '.auto-notes/proposals',
		scanOnStartup: false,
		autoScanInterval: 0,
		detection: {
			minWordThreshold: 50,
			detectTodoMarkers: true,
			detectEmptySections: true,
			detectSparseLinks: true,
			excludeFolders: ['templates', '.auto-notes'],
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
		output: {
			folder: 'Transcriptions',
			fileNameTemplate: '{{date}}-{{source}}',
			appendToExisting: false,
		},
	},
	video: {
		enabled: true,
		ytDlpPath: 'yt-dlp',
		ffmpegPath: 'ffmpeg',
		tempFolder: '.auto-notes/temp',
		supportedPlatforms: {
			youtube: true,
			tiktok: true,
		},
		frameExtraction: {
			enabled: false,
			intervalSeconds: 30,
			visionModel: 'gpt-4o',
			maxFrames: 20,
		},
		output: {
			folder: 'Video Notes',
			fileNameTemplate: '{{date}}-{{title}}',
			includeVideoMetadata: true,
		},
	},
};
