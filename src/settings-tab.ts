import { App, PluginSettingTab, Setting } from 'obsidian';
import type AutoNotesPlugin from './main';
import { MODEL_OPTIONS } from './settings';
import type { AIProvider } from './settings';

export class AutoNotesSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: AutoNotesPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── AI Configuration ──
		containerEl.createEl('h2', { text: 'AI Configuration' });

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

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness (0-1)')
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.1)
					.setValue(this.plugin.settings.ai.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.ai.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Note Elaboration ──
		containerEl.createEl('h2', { text: 'Note Elaboration' });

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

		// ── Audio Transcription ──
		containerEl.createEl('h2', { text: 'Audio Transcription' });

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

		new Setting(containerEl)
			.setName('Transcription provider')
			.addDropdown((dd) =>
				dd
					.addOptions({
						'whisper-api': 'OpenAI Whisper API',
						deepgram: 'Deepgram',
						'local-whisper': 'Local Whisper',
					})
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

		// ── Video Transcription ──
		containerEl.createEl('h2', { text: 'Video Transcription' });

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

		// ── Note Enrichment ──
		containerEl.createEl('h2', { text: 'Note Enrichment' });

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

		new Setting(containerEl)
			.setName('Internal link threshold')
			.setDesc('Minimum relevance score for internal links (0-1, lower = more liberal)')
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(this.plugin.settings.enrichment.internalLinkThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.enrichment.internalLinkThreshold = value;
						await this.plugin.saveSettings();
					})
			);

		// Weight settings
		containerEl.createEl('h3', { text: 'Proximity Weights' });

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
			new Setting(containerEl)
				.setName(field.name)
				.setDesc(field.desc)
				.addSlider((slider) =>
					slider
						.setLimits(0, 1, 0.05)
						.setValue(this.plugin.settings.enrichment.weights[key])
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.enrichment.weights[key] = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// Tag Vocabulary
		containerEl.createEl('h3', { text: 'Tag Vocabulary' });
		containerEl.createEl('p', {
			text: 'Define metadata tag categories. Tags classify notes (status, type, source) — topics become [[links]] instead.',
			cls: 'setting-item-description',
		});

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

		// ── Note Tidy ──
		containerEl.createEl('h2', { text: 'Note Tidy' });

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
	}
}
