import { App, Platform, PluginSettingTab, Setting } from 'obsidian';
import type SynapsePlugin from './main';
import { MODEL_OPTIONS } from './settings';
import type { AIProvider } from './settings';
import { addEnhancedSlider } from './shared';

export class SynapseSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SynapsePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setHeading().setName(`Synapse v${this.plugin.manifest.version}`);

		// ── AI Configuration ──
		new Setting(containerEl).setHeading().setName('AI Configuration');

		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Which AI service to use for elaboration and post-processing')
			.addDropdown((dd) =>
				dd
					.addOptions({
						openai: 'OpenAI',
						anthropic: 'Anthropic',
						ollama: 'Ollama (Local)',
					})
					.setValue(this.plugin.settings.ai.provider)
					.onChange(async (value) => {
						const provider = value as AIProvider;
						this.plugin.settings.ai.provider = provider;
						// Reset model to first option for new provider
						const models = MODEL_OPTIONS[provider];
						this.plugin.settings.ai.model = Object.keys(models)[0];
						await this.plugin.saveSettings();
						this.display(); // Re-render to update model dropdown and conditional fields
					})
			);

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('API key for OpenAI or Anthropic')
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.ai.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.ai.apiKey = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
			});

		if (this.plugin.settings.ai.provider === 'ollama') {
			new Setting(containerEl)
				.setName('Ollama Endpoint')
				.setDesc('URL for local Ollama server (HTTPS required for non-localhost)')
				.addText((text) =>
					text
						.setValue(this.plugin.settings.ai.ollamaEndpoint)
						.onChange(async (value) => {
							// Validate endpoint URL before saving
							try {
								const parsed = new URL(value);
								const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
								if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
									return; // Silently reject; ai-client.ts will also enforce this at call time
								}
							} catch {
								return; // Not a valid URL yet (user may still be typing)
							}
							this.plugin.settings.ai.ollamaEndpoint = value;
							await this.plugin.saveSettings();
						})
				);
		}

		const currentProvider = this.plugin.settings.ai.provider;
		const models = MODEL_OPTIONS[currentProvider];

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Model to use for AI operations')
			.addDropdown((dd) => {
				dd.addOptions(models);
				// If current model isn't in the list, default to first
				if (!(this.plugin.settings.ai.model in models)) {
					this.plugin.settings.ai.model = Object.keys(models)[0];
				}
				dd.setValue(this.plugin.settings.ai.model);
				dd.onChange(async (value) => {
					this.plugin.settings.ai.model = value;
					await this.plugin.saveSettings();
				});
			});

		addEnhancedSlider(
			new Setting(containerEl)
				.setName('Temperature')
				.setDesc('Controls randomness (0-1)'),
			{
				min: 0,
				max: 1,
				step: 0.1,
				value: this.plugin.settings.ai.temperature,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.ai.temperature = value;
					await this.plugin.saveSettings();
				},
			},
		);

		// ── Note Elaboration ──
		new Setting(containerEl).setHeading().setName('Note Elaboration');

		new Setting(containerEl)
			.setName('Enable elaboration')
			.setDesc('Enable stub note detection and proposal generation')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.elaboration.enabled)
					.onChange(async (value) => {
						this.plugin.settings.elaboration.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Minimum word threshold')
			.setDesc('Notes with fewer words than this are considered stubs')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.elaboration.detection.minWordThreshold))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.elaboration.detection.minWordThreshold = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('Detect TODO markers')
			.setDesc('Flag notes containing TODO, TBD, FIXME, PLACEHOLDER')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.elaboration.detection.detectTodoMarkers)
					.onChange(async (value) => {
						this.plugin.settings.elaboration.detection.detectTodoMarkers = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Detect empty sections')
			.setDesc('Flag notes with headings but no content beneath them')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.elaboration.detection.detectEmptySections)
					.onChange(async (value) => {
						this.plugin.settings.elaboration.detection.detectEmptySections = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Comma-separated list of folders to skip')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.elaboration.detection.excludeFolders.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.elaboration.detection.excludeFolders =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		// ── Media Transcription ──
		new Setting(containerEl).setHeading().setName('Media Transcription');

		// ── Audio Transcription ──
		new Setting(containerEl).setHeading().setName('Audio Transcription');

		new Setting(containerEl)
			.setName('Enable audio transcription')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.audio.enabled)
					.onChange(async (value) => {
						this.plugin.settings.audio.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		const providerOptions: Record<string, string> = {
			'whisper-api': 'OpenAI Whisper API',
			deepgram: 'Deepgram',
		};
		if (Platform.isDesktop) {
			providerOptions['local-whisper'] = 'Local Whisper';
		}

		new Setting(containerEl)
			.setName('Transcription provider')
			.addDropdown((dd) =>
				dd
					.addOptions(providerOptions)
					.setValue(this.plugin.settings.audio.transcriptionProvider)
					.onChange(async (value) => {
						this.plugin.settings.audio.transcriptionProvider =
							value as 'whisper-api' | 'deepgram' | 'local-whisper';
						await this.plugin.saveSettings();
						this.display(); // Re-render to show/hide provider-specific fields
					})
			);

		// Show Whisper API key field when provider is whisper-api and AI provider isn't OpenAI
		// (if AI provider is OpenAI, the shared API key is already an OpenAI key)
		if (
			this.plugin.settings.audio.transcriptionProvider === 'whisper-api' &&
			this.plugin.settings.ai.provider !== 'openai'
		) {
			new Setting(containerEl)
				.setName('OpenAI API Key (Whisper)')
				.setDesc(
					'Whisper uses the OpenAI API. Provide your OpenAI key here since your AI provider is set to ' +
					this.plugin.settings.ai.provider.charAt(0).toUpperCase() +
					this.plugin.settings.ai.provider.slice(1) + '.'
				)
				.addText((text) => {
					text
						.setPlaceholder('sk-...')
						.setValue(this.plugin.settings.audio.whisperApiKey)
						.onChange(async (value) => {
							this.plugin.settings.audio.whisperApiKey = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.type = 'password';
					text.inputEl.autocomplete = 'off';
				});
		}

		if (this.plugin.settings.audio.transcriptionProvider === 'deepgram') {
			new Setting(containerEl)
				.setName('Deepgram API Key')
				.setDesc('Required for Deepgram transcription provider')
				.addText((text) => {
					text
						.setPlaceholder('dg-...')
						.setValue(this.plugin.settings.audio.deepgramApiKey)
						.onChange(async (value) => {
							this.plugin.settings.audio.deepgramApiKey = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.type = 'password';
					text.inputEl.autocomplete = 'off';
				});
		}

		new Setting(containerEl)
			.setName('Language')
			.setDesc('Audio language for transcription (auto-detect if empty)')
			.addDropdown((dd) =>
				dd
					.addOptions({
						'': 'Auto-detect',
						en: 'English',
						es: 'Spanish',
						fr: 'French',
						de: 'German',
						ja: 'Japanese',
						zh: 'Chinese',
						ko: 'Korean',
						pt: 'Portuguese',
						ru: 'Russian',
						ar: 'Arabic',
						hi: 'Hindi',
						it: 'Italian',
						nl: 'Dutch',
						pl: 'Polish',
						sv: 'Swedish',
						tr: 'Turkish',
					})
					.setValue(this.plugin.settings.audio.language)
					.onChange(async (value) => {
						this.plugin.settings.audio.language = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Post-processing')
			.setDesc('Clean up and structure transcriptions with AI')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.audio.postProcessing.enabled)
					.onChange(async (value) => {
						this.plugin.settings.audio.postProcessing.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Remove filler words')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.audio.postProcessing.removeFiller)
					.onChange(async (value) => {
						this.plugin.settings.audio.postProcessing.removeFiller = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Video Transcription (desktop only — requires yt-dlp + ffmpeg) ──
		if (Platform.isDesktop) {
			new Setting(containerEl).setHeading().setName('Video Transcription');

			new Setting(containerEl)
				.setName('Enable video transcription')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.video.enabled)
						.onChange(async (value) => {
							this.plugin.settings.video.enabled = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('yt-dlp path')
				.setDesc('Path to yt-dlp binary')
				.addText((text) =>
					text
						.setValue(this.plugin.settings.video.ytDlpPath)
						.onChange(async (value) => {
							this.plugin.settings.video.ytDlpPath = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('ffmpeg path')
				.setDesc('Path to ffmpeg binary')
				.addText((text) =>
					text
						.setValue(this.plugin.settings.video.ffmpegPath)
						.onChange(async (value) => {
							this.plugin.settings.video.ffmpegPath = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Video download folder')
				.setDesc('Where to save downloaded video files in the vault')
				.addText((text) =>
					text
						.setValue(this.plugin.settings.video.downloadFolder)
						.onChange(async (value) => {
							this.plugin.settings.video.downloadFolder = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Embed video in note')
				.setDesc('Add an embed link to the downloaded video file in the note')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.video.embedInNote)
						.onChange(async (value) => {
							this.plugin.settings.video.embedInNote = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// ── Note Enrichment ──
		new Setting(containerEl).setHeading().setName('Note Enrichment');

		new Setting(containerEl)
			.setName('Enable enrichment')
			.setDesc('Add tags, links, references, and metadata to notes')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enrichment.enabled)
					.onChange(async (value) => {
						this.plugin.settings.enrichment.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Auto-enrich')
			.setDesc('Automatically generate enrichment proposals after elaboration or transcription')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enrichment.autoEnrich)
					.onChange(async (value) => {
						this.plugin.settings.enrichment.autoEnrich = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Max metadata tags')
			.setDesc('Maximum number of metadata tags (status, type, source) to suggest per note')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.enrichment.maxTags))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.enrichment.maxTags = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('Max topic links')
			.setDesc('Maximum number of AI-extracted topic links to suggest')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.enrichment.maxTopicLinks))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.enrichment.maxTopicLinks = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('Suggest new notes')
			.setDesc('Suggest links to notes that don\'t exist yet (Obsidian grayed-out links)')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enrichment.suggestNewNotes)
					.onChange(async (value) => {
						this.plugin.settings.enrichment.suggestNewNotes = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Max internal links')
			.setDesc('Maximum number of related note links to suggest')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.enrichment.maxInternalLinks))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.enrichment.maxInternalLinks = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('Max external references')
			.setDesc('Maximum external links to suggest (stingy — keep this low)')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.enrichment.maxExternalLinks))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 0) {
							this.plugin.settings.enrichment.maxExternalLinks = num;
							await this.plugin.saveSettings();
						}
					})
			);

		addEnhancedSlider(
			new Setting(containerEl)
				.setName('Internal link threshold')
				.setDesc('Minimum relevance score for internal links (0-1, lower = more liberal)'),
			{
				min: 0,
				max: 1,
				step: 0.05,
				value: this.plugin.settings.enrichment.internalLinkThreshold,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.enrichment.internalLinkThreshold = value;
					await this.plugin.saveSettings();
				},
			},
		);

		// Weight settings
		new Setting(containerEl).setHeading().setName('Proximity Weights');

		type WeightKey = keyof import('./settings').EnrichmentWeightSettings;
		const weightFields: Array<{ key: WeightKey; name: string; desc: string }> = [
			{ key: 'sameFolder', name: 'Same folder', desc: 'Weight for files in the same folder' },
			{ key: 'siblingFolder', name: 'Sibling folder', desc: 'Weight for files in sibling folders' },
			{ key: 'cousinFolder', name: 'Cousin folder', desc: 'Weight for files two levels apart' },
			{ key: 'distantFolder', name: 'Distant folder', desc: 'Weight for files in distant folders' },
			{ key: 'decayPerLevel', name: 'Decay per level', desc: 'Weight reduction per additional folder hop' },
			{ key: 'minWeight', name: 'Minimum weight', desc: 'Floor weight — distant files are never invisible' },
		];

		for (const field of weightFields) {
			const key = field.key;
			addEnhancedSlider(
				new Setting(containerEl)
					.setName(field.name)
					.setDesc(field.desc),
				{
					min: 0,
					max: 1,
					step: 0.05,
					value: this.plugin.settings.enrichment.weights[key],
					showTicks: true,
					onChange: async (value) => {
						this.plugin.settings.enrichment.weights[key] = value;
						await this.plugin.saveSettings();
					},
				},
			);
		}

		// Tag Vocabulary
		new Setting(containerEl).setHeading().setName('Tag Vocabulary').setDesc('Define metadata tag categories. Tags classify notes (status, type, source) — topics become [[links]] instead.');

		for (let i = 0; i < this.plugin.settings.enrichment.tagVocabulary.length; i++) {
			const entry = this.plugin.settings.enrichment.tagVocabulary[i];

			new Setting(containerEl)
				.setName(entry.category)
				.setDesc(entry.description)
				.addText((text) =>
					text
						.setValue(entry.tags.join(', '))
						.setPlaceholder('tag1, tag2, tag3')
						.onChange(async (value) => {
							this.plugin.settings.enrichment.tagVocabulary[i].tags =
								value.split(',').map(s => s.trim()).filter(Boolean);
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Comma-separated list of folders to skip for enrichment')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.enrichment.excludeFolders.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.enrichment.excludeFolders =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Excluded tags')
			.setDesc('Notes with these tags will skip enrichment')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.enrichment.excludeTags.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.enrichment.excludeTags =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		// ── Summarize ──
		new Setting(containerEl).setHeading().setName('Summarize');

		new Setting(containerEl)
			.setName('Enable summarize')
			.setDesc('Summarize URLs and transcriptions in notes')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.summarize.enabled)
					.onChange(async (value) => {
						this.plugin.settings.summarize.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Summary style')
			.setDesc('Format for generated summaries')
			.addDropdown((dd) =>
				dd
					.addOptions({
						bullets: 'Bullet Points',
						paragraph: 'Paragraph',
						'key-points': 'Key Points',
					})
					.setValue(this.plugin.settings.summarize.summaryStyle)
					.onChange(async (value) => {
						this.plugin.settings.summarize.summaryStyle =
							value as 'bullets' | 'paragraph' | 'key-points';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Auto-detect content templates')
			.setDesc('Automatically detect content type (e.g. recipes) and use a specialized summary format')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.summarize.autoDetectTemplates)
				.onChange(async (value) => {
					this.plugin.settings.summarize.autoDetectTemplates = value;
					await this.plugin.saveSettings();
				}));

		addEnhancedSlider(
			new Setting(containerEl)
				.setName('Max content length')
				.setDesc('Maximum characters of content to send to AI for summarization'),
			{
				min: 1000,
				max: 10000,
				step: 500,
				value: this.plugin.settings.summarize.maxContentLength,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.summarize.maxContentLength = value;
					await this.plugin.saveSettings();
				},
			},
		);

		new Setting(containerEl)
			.setName('Custom prompt')
			.setDesc('Override the default summarization prompt (leave empty for default)')
			.addTextArea((text) =>
				text
					.setPlaceholder('Custom summarization instructions...')
					.setValue(this.plugin.settings.summarize.customPrompt)
					.onChange(async (value) => {
						this.plugin.settings.summarize.customPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Comma-separated list of folders to skip for summarization')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.summarize.excludeFolders.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.summarize.excludeFolders =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Excluded tags')
			.setDesc('Notes with these tags will skip summarization')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.summarize.excludeTags.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.summarize.excludeTags =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Auto-organize after summarize')
			.setDesc('Automatically organize the current note after summarization completes (single-note only, not vault-wide)')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.summarize.autoOrganizeOnSummarize)
					.onChange(async (value) => {
						this.plugin.settings.summarize.autoOrganizeOnSummarize = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Note Tidy ──
		new Setting(containerEl).setHeading().setName('Note Tidy');

		new Setting(containerEl)
			.setName('Enable tidy')
			.setDesc('Spelling correction and markdown formatting (no content changes)')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.tidy.enabled)
					.onChange(async (value) => {
						this.plugin.settings.tidy.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Note Organize ──
		new Setting(containerEl).setHeading().setName('Note Organize');

		new Setting(containerEl)
			.setName('Enable organize')
			.setDesc('AI-powered semantic directory structuring for notes')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.organize.enabled)
					.onChange(async (value) => {
						this.plugin.settings.organize.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		addEnhancedSlider(
			new Setting(containerEl)
				.setName('New folder confidence threshold')
				.setDesc('Minimum topic confidence to propose a new folder (0.5-1.0). Higher = fewer new folders.'),
			{
				min: 0.5,
				max: 1.0,
				step: 0.05,
				value: this.plugin.settings.organize.organizeConfidenceThreshold,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.organize.organizeConfidenceThreshold = value;
					await this.plugin.saveSettings();
				},
			},
		);

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Comma-separated list of folders to skip for organization')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.organize.excludeFolders.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.organize.excludeFolders =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Excluded tags')
			.setDesc('Notes with these tags will skip organization')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.organize.excludeTags.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.organize.excludeTags =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		// ── Deep Dive ──
		new Setting(containerEl).setHeading().setName('Deep Dive');

		new Setting(containerEl)
			.setName('Enable deep dive')
			.setDesc('Recursively explore a note into a tree of interlinked child notes')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deepDive.enabled)
					.onChange(async (value) => {
						this.plugin.settings.deepDive.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		addEnhancedSlider(
			new Setting(containerEl)
				.setName('Max depth')
				.setDesc('Maximum levels of recursion (1-5)'),
			{
				min: 1,
				max: 5,
				step: 1,
				value: this.plugin.settings.deepDive.maxDepth,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.deepDive.maxDepth = value;
					await this.plugin.saveSettings();
				},
			},
		);

		addEnhancedSlider(
			new Setting(containerEl)
				.setName('Quality threshold')
				.setDesc('Minimum quality score to continue recursing (0.1-0.9)'),
			{
				min: 0.1,
				max: 0.9,
				step: 0.05,
				value: this.plugin.settings.deepDive.qualityThreshold,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.deepDive.qualityThreshold = value;
					await this.plugin.saveSettings();
				},
			},
		);

		addEnhancedSlider(
			new Setting(containerEl)
				.setName('Max notes per run')
				.setDesc('Maximum number of notes to generate in a single deep dive (10-100)'),
			{
				min: 10,
				max: 100,
				step: 5,
				value: this.plugin.settings.deepDive.maxNotesPerRun,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.deepDive.maxNotesPerRun = value;
					await this.plugin.saveSettings();
				},
			},
		);

		new Setting(containerEl)
			.setName('Note output folder')
			.setDesc('Where to create new notes. Uses a subfolder per root note. (empty = same folder as source)')
			.addText((text) =>
				text
					.setPlaceholder('Deep Dives')
					.setValue(this.plugin.settings.deepDive.noteOutputFolder)
					.onChange(async (value) => {
						this.plugin.settings.deepDive.noteOutputFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Folder nesting mode')
			.setDesc('How child notes are placed: nested under parent topic folders, flat in a single folder, or AI-organized by content semantics')
			.addDropdown((dd) =>
				dd
					.addOptions({
						nested: 'Nested (subfolder per parent topic)',
						flat: 'Flat (all in root subfolder)',
						'auto-organize': 'Auto-organize (AI-based placement)',
					})
					.setValue(this.plugin.settings.deepDive.nestingMode || 'nested')
					.onChange(async (value) => {
						this.plugin.settings.deepDive.nestingMode =
							value as 'nested' | 'flat' | 'auto-organize';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Auto-enrich on accept')
			.setDesc('Automatically trigger enrichment when a deep dive note is accepted')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deepDive.autoEnrichOnAccept)
					.onChange(async (value) => {
						this.plugin.settings.deepDive.autoEnrichOnAccept = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Auto-organize on accept')
			.setDesc('Automatically trigger organize when a deep dive note is accepted')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deepDive.autoOrganizeOnAccept)
					.onChange(async (value) => {
						this.plugin.settings.deepDive.autoOrganizeOnAccept = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Comma-separated list of folders to skip for deep dive')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.deepDive.excludeFolders.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.deepDive.excludeFolders =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Excluded tags')
			.setDesc('Notes with these tags will skip deep dive')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.deepDive.excludeTags.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.deepDive.excludeTags =
							value.split(',').map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		// ── REM (Link Discovery) ──
		new Setting(containerEl).setHeading().setName('REM (Link Discovery)');

		new Setting(containerEl)
			.setName('Enable REM')
			.setDesc('Scan notes for mentions of other note titles and propose in-place [[wikilink]] insertions')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rem.enabled)
					.onChange(async (value) => {
						this.plugin.settings.rem.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Semantic matching')
			.setDesc('Use AI to find conceptual matches beyond literal title/alias matching')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rem.semanticMatching)
					.onChange(async (value) => {
						this.plugin.settings.rem.semanticMatching = value;
						await this.plugin.saveSettings();
					})
			);

		addEnhancedSlider(
			new Setting(containerEl)
				.setName('Confidence threshold')
				.setDesc('Minimum confidence for semantic matches (0-1)'),
			{
				min: 0,
				max: 1,
				step: 0.05,
				value: this.plugin.settings.rem.confidenceThreshold,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.rem.confidenceThreshold = value;
					await this.plugin.saveSettings();
				},
			},
		);

		new Setting(containerEl)
			.setName('Max links per note')
			.setDesc('Maximum number of link candidates to suggest per scanned note')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.rem.maxLinksPerNote))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.rem.maxLinksPerNote = num;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
