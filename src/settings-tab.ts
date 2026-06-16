import { App, Platform, PluginSettingTab, Setting } from 'obsidian';
import type SynapsePlugin from './main';
import { MODEL_OPTIONS } from './settings';
import type { AIProvider } from './settings';
import {
	addEnhancedSlider,
	createSettingsSectionContext,
	FolderPickerModal,
	ALL_FEATURE_IDS,
	renderFeatureChipSelect,
} from './shared';
import type { SettingsSectionContext, FeatureId, ExclusionRule } from './shared';
import { PROPOSAL_KINDS } from './views';
import type { ProposalKind } from './views';
import { renderElaborationSettings } from './elaboration';
import { renderIntakeSettings } from './intake';
import { renderImageSettings } from './image';
import { renderAudioSettings } from './audio';
import { renderTranscriptionCredentials } from './audio/transcription-credentials';
import { renderVideoSettings } from './video';
import { renderEnrichmentSettings } from './enrichment';
import { renderSummarizeSettings } from './summarize';
import { renderTidySettings } from './tidy';
import { renderOrganizeSettings } from './organize';
import { renderDeepDiveSettings } from './deep-dive';
import { renderRemSettings } from './rem';
import { applyApiKeyEmphasis } from './onboarding';

/**
 * Per-kind display copy for the Auto-Accept Proposals section (#228). MUTATING
 * kinds carry a caution note in their description: organize moves notes, title
 * renames files, rem rewrites body text.
 */
const AUTO_ACCEPT_LABELS: Record<ProposalKind, { name: string; desc: string }> = {
	elaboration: {
		name: 'Elaboration',
		desc: 'Automatically accept elaboration proposals as generated (appends an elaboration callout to the note).',
	},
	enrichment: {
		name: 'Enrichment',
		desc: 'Automatically accept all suggested tags, links, references, and metadata as generated.',
	},
	organize: {
		name: 'Organize',
		desc: 'Caution: moves notes. Automatically accept organize proposals, relocating notes into the proposed folders without review.',
	},
	'deep-dive': {
		name: 'Deep dive',
		desc: 'Automatically accept every generated deep dive note in a run, creating all of them in the vault.',
	},
	title: {
		name: 'Title',
		desc: 'Caution: renames files. Automatically accept title proposals, renaming notes without review.',
	},
	rem: {
		name: 'REM (link discovery)',
		desc: 'Caution: rewrites note body text. Automatically insert all discovered [[wikilinks]] without review.',
	},
};

/**
 * Display labels for every {@link FeatureId}, shown as the per-feature checkbox
 * labels in the Exclusions section (#307). Keyed by the canonical feature set so
 * a new {@link FeatureId} forces an entry here. The render order is
 * {@link FEATURE_ORDER}.
 */
const FEATURE_LABELS: Record<FeatureId, string> = {
	elaboration: 'Elaboration',
	enrichment: 'Enrichment',
	summarize: 'Summarize',
	tidy: 'Tidy',
	organize: 'Organize',
	'deep-dive': 'Deep dive',
	audio: 'Audio transcription',
	video: 'Video transcription',
	title: 'Title',
	image: 'Image OCR',
	rem: 'REM (link discovery)',
	intake: 'Intake watcher',
};

/** Stable display order for the per-feature exclusion checkboxes. */
const FEATURE_ORDER = Object.keys(ALL_FEATURE_IDS) as FeatureId[];

/**
 * The ordered list of per-feature section renderers (#243). Video is gated
 * behind `Platform.isDesktop` in {@link SynapseSettingTab.display} and inserted
 * here at render time, preserving the historical section order:
 * Elaboration, Intake, Image, Audio, Video, Enrichment, Summarize, Tidy,
 * Organize, Deep Dive, REM.
 */
const FEATURE_SECTION_RENDERERS: Array<(ctx: SettingsSectionContext) => void> = [
	renderElaborationSettings,
	renderIntakeSettings,
	renderImageSettings,
	renderAudioSettings,
	// renderVideoSettings is spliced in after Audio when Platform.isDesktop.
	renderEnrichmentSettings,
	renderSummarizeSettings,
	renderTidySettings,
	renderOrganizeSettings,
	renderDeepDiveSettings,
	renderRemSettings,
];

/**
 * Thin orchestrator for the settings tab (#243). Owns only cross-cutting
 * concerns: the version heading, section ORDER, platform gating (Video), and
 * the global/non-feature sections (AI Configuration, Auto-Accept Proposals).
 * Each feature renders its own section through a `render<Feature>Settings(ctx)`
 * function imported from the feature's public `index.ts` — the tab never reaches
 * into a feature's internals, and no feature imports from this file.
 */
export class SynapseSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SynapsePlugin) {
		super(app, plugin);
	}

	/**
	 * Live references to the per-kind Auto-Accept rows, keyed by ProposalKind.
	 * Rebuilt on every {@link display}. Lets a feature enable/disable toggle grey
	 * out the matching row in place (see {@link refreshAutoAcceptDisabledState}).
	 */
	private autoAcceptSettings: Partial<Record<ProposalKind, Setting>> = {};

	/**
	 * Whether the feature that produces a given proposal kind is enabled. When a
	 * feature is off, its Auto-Accept row is greyed out — but its stored value is
	 * never touched, so re-enabling restores the toggle exactly as left. Note the
	 * keys are not 1:1: `deep-dive` maps to the `deepDive` settings group.
	 */
	private isFeatureEnabled(kind: ProposalKind): boolean {
		const s = this.plugin.settings;
		switch (kind) {
			case 'elaboration':
				return s.elaboration.enabled;
			case 'enrichment':
				return s.enrichment.enabled;
			case 'organize':
				return s.organize.enabled;
			case 'deep-dive':
				return s.deepDive.enabled;
			case 'title':
				return s.title.enabled;
			case 'rem':
				return s.rem.enabled;
		}
	}

	/** Description for an Auto-Accept row, with a hint appended when disabled. */
	private autoAcceptDesc(kind: ProposalKind): string {
		const { name, desc } = AUTO_ACCEPT_LABELS[kind];
		return this.isFeatureEnabled(kind)
			? desc
			: `${desc} (Enable ${name} to configure auto-accept.)`;
	}

	/**
	 * Sync every rendered Auto-Accept row's disabled state (and hint) to its
	 * feature's enabled flag. Called after a feature enable toggle so the change
	 * propagates live, without re-rendering the whole settings tab.
	 */
	private refreshAutoAcceptDisabledState(): void {
		for (const kind of PROPOSAL_KINDS) {
			const setting = this.autoAcceptSettings[kind];
			if (!setting) continue;
			setting.setDisabled(!this.isFeatureEnabled(kind));
			setting.setDesc(this.autoAcceptDesc(kind));
		}
	}

	// NOTE: Migrating this imperative display() to the declarative
	// getSettingDefinitions() API is deferred until minAppVersion >= 1.13.0.
	// The project builds against obsidian 1.7.2, where display() is not
	// deprecated and getSettingDefinitions does not yet exist.
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Rebuilt each render; feature toggles flip Auto-Accept rows' disabled
		// state live via the context's onFeatureToggle hook.
		this.autoAcceptSettings = {};

		const ctx = createSettingsSectionContext({
			containerEl,
			plugin: this.plugin,
			onFeatureToggle: () => this.refreshAutoAcceptDisabledState(),
			rerender: () => this.display(),
		});

		// ── AI Configuration (always-needed config — no enable toggle) ──
		this.renderAIConfiguration(ctx);

		// ── Auto-Accept Proposals (global, non-feature) ──
		this.renderAutoAccept(ctx);

		// ── Exclusions (global, cross-cutting path exclusion list) ──
		this.renderExclusions(ctx);

		// ── Per-feature sections, in order (Video gated to desktop) ──
		for (const render of FEATURE_SECTION_RENDERERS) {
			render(ctx);
			// Video Transcription slots in after Audio (desktop only — requires
			// yt-dlp + ffmpeg). Splicing here keeps the historical section order.
			if (render === renderAudioSettings && Platform.isDesktop) {
				renderVideoSettings(ctx);
			}
		}

		// ── About (static support links, always last) ──
		this.renderAbout(ctx);

		// Version as a muted footer line. The settings tab must not carry a
		// top-level plugin-name heading (Obsidian community guidelines), so the
		// version moves here, below everything else.
		containerEl.createDiv({
			cls: 'setting-item-description synapse-settings-footer',
			text: `Synapse v${this.plugin.manifest.version}`,
		});
	}

	/**
	 * AI Configuration — always-needed config shared across features. No enable
	 * toggle; collapsible with persisted state. Orchestrator-owned because it is
	 * not tied to any single feature.
	 */
	private renderAIConfiguration(ctx: SettingsSectionContext): void {
		const aiBody = ctx.configSection('ai', 'AI configuration');

		new Setting(aiBody)
			.setName('AI provider')
			.setDesc('Which AI service to use for elaboration and post-processing')
			.addDropdown((dd) =>
				dd
					.addOptions({
						openai: 'OpenAI',
						anthropic: 'Anthropic',
						gemini: 'Google Gemini',
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

		// The description and a violet "required" accent are driven by
		// applyApiKeyEmphasis so a brand-new user sees the one field that gates
		// every AI feature highlighted until they fill it (#89). Toggled live as
		// they type — no full re-render, so the field keeps focus.
		const apiKeySetting = new Setting(aiBody)
			.setName('API key')
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.ai.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.ai.apiKey = value;
						await this.plugin.saveSettings();
						applyApiKeyEmphasis(apiKeySetting, this.plugin.settings);
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
			});
		applyApiKeyEmphasis(apiKeySetting, this.plugin.settings);

		if (this.plugin.settings.ai.provider === 'ollama') {
			new Setting(aiBody)
				.setName('Ollama endpoint')
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

		// Transcription provider + its provider-specific API-key fields (#332).
		// They configure audio transcription but live here because the choice of
		// transcription provider is coupled to the AI provider above (e.g. when
		// the AI provider already supplies the needed key). Changing either
		// provider re-renders the tab, resolving the coupling.
		renderTranscriptionCredentials(aiBody, ctx);

		const currentProvider = this.plugin.settings.ai.provider;
		const models = MODEL_OPTIONS[currentProvider];

		new Setting(aiBody)
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
			new Setting(aiBody)
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

		addEnhancedSlider(
			new Setting(aiBody)
				.setName('Max tokens')
				.setDesc('Maximum tokens in AI responses (256-8192)'),
			{
				min: 256,
				max: 8192,
				step: 256,
				value: this.plugin.settings.ai.maxTokens,
				showTicks: true,
				onChange: async (value) => {
					this.plugin.settings.ai.maxTokens = value;
					await this.plugin.saveSettings();
				},
			},
		);
	}

	/**
	 * Auto-Accept Proposals — a group of per-kind toggles with no feature enable
	 * toggle. Orchestrator-owned: each row's disabled state mirrors its producing
	 * feature's enabled flag, and feature toggles refresh these rows live via
	 * {@link refreshAutoAcceptDisabledState}.
	 */
	private renderAutoAccept(ctx: SettingsSectionContext): void {
		// Rendered like the AI Configuration section: a collapsible config
		// section with no header toggle, persisting its own collapse state.
		const autoAcceptBody = ctx.configSection('autoAccept', 'Auto-accept proposals');

		autoAcceptBody.createDiv({
			cls: 'setting-item-description synapse-accordion-empty-note',
			text: 'When enabled for a proposal type, future proposals of that type are accepted automatically as generated, applied without review. Already-pending proposals are left untouched. Off by default for every type.',
		});

		for (const kind of PROPOSAL_KINDS) {
			const { name } = AUTO_ACCEPT_LABELS[kind];
			const setting = new Setting(autoAcceptBody)
				.setName(name)
				.setDesc(this.autoAcceptDesc(kind))
				.addToggle((toggle) =>
					toggle
						// The stored value is shown verbatim even while disabled, and
						// onChange never fires on a disabled toggle — so a disable →
						// re-enable cycle preserves the user's setting for free.
						.setValue(this.plugin.settings.autoAccept[kind])
						.onChange(async (value) => {
							this.plugin.settings.autoAccept[kind] = value;
							await this.plugin.saveSettings();
						})
				);
			// Grey out (and disable child toggle) when the feature is off.
			setting.setDisabled(!this.isFeatureEnabled(kind));
			this.autoAcceptSettings[kind] = setting;
		}
	}

	/**
	 * Exclusions — a cross-cutting list of vault paths hidden from some or all
	 * Synapse flows (#307). Top-level (not per-feature): the single source of
	 * truth for path-based exclusion. Each rule shows its glob pattern, a remove
	 * button, and a chip multi-select for its feature scope (#328 — replaced the
	 * "All features" toggle + 12 per-feature checkboxes). New rules are added via a
	 * folder picker (canonicalized to `<folder>/**`) or a free-text pattern (exact
	 * paths, `dir/*`), with their scope chosen up front. Adding or removing a whole
	 * rule re-renders the tab via `ctx.rerender`; editing a scope self-redraws only
	 * its chip row.
	 */
	private renderExclusions(ctx: SettingsSectionContext): void {
		const body = ctx.configSection('exclusions', 'Exclusions');

		body.createDiv({
			cls: 'setting-item-description synapse-accordion-empty-note',
			text:
				'Paths listed here are skipped by the selected features. Patterns are vault-relative globs: ' +
				'"folder/**" (folder and everything under it), "folder/*" (direct children only), ' +
				'or an exact note path. ".synapse" (plugin data) and "templates" are excluded from every feature by default.',
		});

		const rules = this.plugin.settings.exclusions;

		if (rules.length === 0) {
			body.createDiv({
				cls: 'setting-item-description',
				text: 'No exclusions configured.',
			});
		}

		rules.forEach((rule, index) => {
			this.renderExclusionRule(ctx, body, rule, index);
		});

		// ── Add controls ──
		// Each add row carries an up-front scope picker (the chips below it). The
		// chosen scope is read when the rule is created, so the user no longer has
		// to add as "all" and narrow afterward. Scope edits update the pending
		// value and self-redraw their own chip container — they must NOT re-render
		// the tab (that would wipe the "Add a pattern" text input mid-entry).
		let pendingFolderScope: 'all' | FeatureId[] = 'all';
		new Setting(body)
			.setName('Add a folder')
			.setDesc('Pick a folder to exclude (saved as "folder/**"). The chips below set which features it is excluded from.')
			.addButton((btn) =>
				btn
					.setButtonText('Choose folder')
					.onClick(() => {
						new FolderPickerModal(this.app, (folder) => {
							const pattern = folder.isRoot() ? '/**' : `${folder.path}/**`;
							// Skip exact duplicates so a re-pick doesn't stack rules.
							if (!this.plugin.settings.exclusions.some((r) => r.pattern === pattern)) {
								this.plugin.settings.exclusions.push({ pattern, features: pendingFolderScope });
							}
							void this.plugin.saveSettings().then(() => ctx.rerender());
						}).open();
					})
			);
		renderFeatureChipSelect(body.createDiv({ cls: 'synapse-exclusion-chips' }), {
			value: pendingFolderScope,
			labels: FEATURE_LABELS,
			order: FEATURE_ORDER,
			onChange: (next) => {
				pendingFolderScope = next;
			},
		});

		let pendingPattern = '';
		let pendingPatternScope: 'all' | FeatureId[] = 'all';
		new Setting(body)
			.setName('Add a pattern')
			.setDesc('For exact note paths or direct-children globs (e.g. "Inbox/*"). The chips below set which features it is excluded from.')
			.addText((text) =>
				text
					.setPlaceholder('path/to/note.md or folder/*')
					.onChange((value) => {
						pendingPattern = value;
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Add')
					.onClick(() => {
						const pattern = pendingPattern.trim();
						if (!pattern) return;
						if (!this.plugin.settings.exclusions.some((r) => r.pattern === pattern)) {
							this.plugin.settings.exclusions.push({ pattern, features: pendingPatternScope });
						}
						void this.plugin.saveSettings().then(() => ctx.rerender());
					})
			);
		renderFeatureChipSelect(body.createDiv({ cls: 'synapse-exclusion-chips' }), {
			value: pendingPatternScope,
			labels: FEATURE_LABELS,
			order: FEATURE_ORDER,
			onChange: (next) => {
				pendingPatternScope = next;
			},
		});
	}

	/**
	 * Render a single exclusion rule row: the pattern name, a remove button, and a
	 * chip multi-select for the rule's feature scope (#328). The chip control owns
	 * the `'all' | FeatureId[]` value (incl. the `'all'` shorthand and the empty =
	 * "rule inactive" case); editing it persists and self-redraws, so only removing
	 * the rule re-renders the tab.
	 */
	private renderExclusionRule(
		ctx: SettingsSectionContext,
		body: HTMLElement,
		rule: ExclusionRule,
		index: number,
	): void {
		new Setting(body)
			.setName(rule.pattern || '(empty pattern)')
			.addExtraButton((btn) =>
				btn
					.setIcon('trash')
					.setTooltip('Remove exclusion')
					.onClick(() => {
						this.plugin.settings.exclusions.splice(index, 1);
						void this.plugin.saveSettings().then(() => ctx.rerender());
					}),
			);

		renderFeatureChipSelect(body.createDiv({ cls: 'synapse-exclusion-chips' }), {
			value: rule.features,
			labels: FEATURE_LABELS,
			order: FEATURE_ORDER,
			onChange: (next) => {
				this.plugin.settings.exclusions[index].features = next;
				void this.plugin.saveSettings();
			},
		});
	}

	/**
	 * About — one static support line below all functional settings (#274).
	 * Set once, never animated, never usage-triggered. Obsidian also renders the
	 * manifest `fundingUrl` links natively; this row is the in-tab mirror, and
	 * its links must stay in sync with `manifest.json` and `.github/FUNDING.yml`.
	 */
	private renderAbout(ctx: SettingsSectionContext): void {
		const aboutBody = ctx.configSection('about', 'About');
		const line = aboutBody.createDiv({ cls: 'setting-item-description' });
		line.createSpan({
			text: 'Synapse is free and open source. Support development → ',
		});
		line.createEl('a', {
			text: 'GitHub Sponsors',
			attr: { href: 'https://github.com/sponsors/dustinkeeton' },
		});
		line.createSpan({ text: ' · ' });
		line.createEl('a', {
			text: 'Buy Me a Coffee',
			attr: { href: 'https://www.buymeacoffee.com/dustinkeeton' },
		});
	}
}
