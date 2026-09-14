import { Setting } from 'obsidian';
import { MODEL_OPTIONS } from '../settings';
import type { AIProvider } from '../settings';
import {
	addEnhancedSlider,
	FolderPickerModal,
	ALL_FEATURE_IDS,
	renderFeatureChipSelect,
	PROVIDER_METADATA,
	aiProviderToCredential,
	decorateCredentialField,
	ConfirmModal,
	applyResetAll,
} from '../shared';
import type {
	SettingsSectionContext,
	FeatureId,
	ExclusionRule,
	CredentialFieldHandle,
} from '../shared';
import { PROPOSAL_KINDS } from '../views';
import type { ProposalKind } from '../views';
import { renderTranscriptionCredentials } from '../audio';
import { applyApiKeyEmphasis, API_KEY_NO_SUBSCRIPTION_NOTE } from '../onboarding';
import { foldActiveNoteProperties } from '../properties-fold';
import { ChangelogModal } from '../changelog';

/** Per-kind Auto-Accept copy; mutating kinds (organize, title, rem) carry a caution. */
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

/** Exclusion checkbox labels, keyed by the canonical feature set (#307). */
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

const FEATURE_ORDER = Object.keys(ALL_FEATURE_IDS) as FeatureId[];

/** AI configuration — shared provider/key/model settings, no enable toggle. */
export function renderAiConfiguration(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
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
				.setValue(plugin.settings.ai.provider)
				.onChange(async (value) => {
					const provider = value as AIProvider;
					plugin.settings.ai.provider = provider;
					const models = MODEL_OPTIONS[provider];
					plugin.settings.ai.model = Object.keys(models)[0];
					await plugin.saveSettings();
					ctx.rerender();
				})
		);

	const cred = aiProviderToCredential(plugin.settings.ai.provider);
	const keyMeta = PROVIDER_METADATA[cred];
	let credentialField: CredentialFieldHandle | undefined;
	const apiKeySetting = new Setting(aiBody)
		.setName('API key')
		.addText((text) => {
			text
				.setPlaceholder(keyMeta.requiresKey ? keyMeta.placeholder : 'sk-...')
				.setValue(plugin.settings.ai.apiKey)
				.onChange(async (value) => {
					plugin.settings.ai.apiKey = value;
					await plugin.saveSettings();
					applyApiKeyEmphasis(apiKeySetting, plugin.settings);
					credentialField?.reset();
				});
			text.inputEl.type = 'password';
			text.inputEl.autocomplete = 'off';
		});
	applyApiKeyEmphasis(apiKeySetting, plugin.settings);
	// Ollama needs no key; its endpoint gets its own reachability test below.
	if (keyMeta.requiresKey) {
		credentialField = decorateCredentialField({
			setting: apiKeySetting,
			provider: cred,
			getKey: () => plugin.settings.ai.apiKey,
		});
		aiBody.createDiv({
			cls: 'setting-item-description synapse-api-key-note',
			text: API_KEY_NO_SUBSCRIPTION_NOTE,
		});
	}

	if (plugin.settings.ai.provider === 'ollama') {
		let ollamaField: CredentialFieldHandle | undefined;
		const endpointSetting = new Setting(aiBody)
			.setName('Ollama endpoint')
			.setDesc('URL for local Ollama server (HTTPS required for non-localhost)')
			.addText((text) =>
				text
					.setPlaceholder(PROVIDER_METADATA.ollama.placeholder)
					.setValue(plugin.settings.ai.ollamaEndpoint)
					.onChange(async (value) => {
						// ai-client.ts enforces the same scheme rule at call time.
						try {
							const parsed = new URL(value);
							const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
							if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
								return;
							}
						} catch {
							return;
						}
						plugin.settings.ai.ollamaEndpoint = value;
						await plugin.saveSettings();
						ollamaField?.reset();
					})
			);
		ollamaField = decorateCredentialField({
			setting: endpointSetting,
			provider: 'ollama',
			getKey: () => '',
			getEndpoint: () => plugin.settings.ai.ollamaEndpoint,
		});
	}

	// Transcription provider lives here because its choice is coupled to the AI provider (#332).
	renderTranscriptionCredentials(aiBody, ctx);

	const models = MODEL_OPTIONS[plugin.settings.ai.provider];

	new Setting(aiBody)
		.setName('Model')
		.setDesc('Model to use for AI operations')
		.addDropdown((dd) => {
			dd.addOptions(models);
			if (!(plugin.settings.ai.model in models)) {
				plugin.settings.ai.model = Object.keys(models)[0];
			}
			dd.setValue(plugin.settings.ai.model);
			dd.onChange(async (value) => {
				plugin.settings.ai.model = value;
				await plugin.saveSettings();
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
			value: plugin.settings.ai.temperature,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.ai.temperature = value;
				await plugin.saveSettings();
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
			value: plugin.settings.ai.maxTokens,
			showTicks: true,
			onChange: async (value) => {
				plugin.settings.ai.maxTokens = value;
				await plugin.saveSettings();
			},
		},
	);

	new Setting(aiBody)
		.setName('Cache identical AI responses')
		.setDesc(
			'Reuse the previous result for an identical request instead of spending again. ' +
			'Caching is automatic at temperature 0; turn this on to cache at any temperature. ' +
			'"Regenerate" actions always bypass the cache.'
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.ai.cacheResponses)
				.onChange(async (value) => {
					plugin.settings.ai.cacheResponses = value;
					await plugin.saveSettings();
				})
		);
}

/** Whether the feature producing `kind` is enabled; `deep-dive` maps to `deepDive`. */
function isFeatureEnabled(ctx: SettingsSectionContext, kind: ProposalKind): boolean {
	const s = ctx.plugin.settings;
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

function autoAcceptDesc(ctx: SettingsSectionContext, kind: ProposalKind): string {
	const { name, desc } = AUTO_ACCEPT_LABELS[kind];
	return isFeatureEnabled(ctx, kind)
		? desc
		: `${desc} (Enable ${name} to configure auto-accept.)`;
}

/**
 * Auto-accept proposals — one toggle per proposal kind (#228). A row is greyed
 * out (stored value untouched) while its producing feature is disabled, and
 * refreshed in place via `ctx.onFeatureToggle`.
 */
export function renderAutoAccept(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	const body = ctx.configSection('autoAccept', 'Auto-accept proposals');

	body.createDiv({
		cls: 'setting-item-description synapse-accordion-empty-note',
		text: 'When enabled for a proposal type, future proposals of that type are accepted automatically as generated, applied without review. Already-pending proposals are left untouched. Off by default for every type.',
	});

	const rows: Partial<Record<ProposalKind, Setting>> = {};
	for (const kind of PROPOSAL_KINDS) {
		const setting = new Setting(body)
			.setName(AUTO_ACCEPT_LABELS[kind].name)
			.setDesc(autoAcceptDesc(ctx, kind))
			.addToggle((toggle) =>
				toggle
					.setValue(plugin.settings.autoAccept[kind])
					.onChange(async (value) => {
						plugin.settings.autoAccept[kind] = value;
						await plugin.saveSettings();
					})
			);
		setting.setDisabled(!isFeatureEnabled(ctx, kind));
		rows[kind] = setting;
	}

	ctx.onFeatureToggle(() => {
		for (const kind of PROPOSAL_KINDS) {
			const setting = rows[kind];
			if (!setting) continue;
			setting.setDisabled(!isFeatureEnabled(ctx, kind));
			setting.setDesc(autoAcceptDesc(ctx, kind));
		}
	});
}

function renderExclusionRule(
	ctx: SettingsSectionContext,
	body: HTMLElement,
	rule: ExclusionRule,
	index: number,
): void {
	const { plugin } = ctx;
	const ruleSetting = new Setting(body)
		.setName(rule.pattern || '(empty pattern)')
		.addExtraButton((btn) =>
			btn
				.setIcon('trash')
				.setTooltip('Remove exclusion')
				.onClick(() => {
					plugin.settings.exclusions.splice(index, 1);
					void plugin.saveSettings().then(() => ctx.rerender());
				}),
		);

	ruleSetting.settingEl.addClass('synapse-setting--has-helper');
	renderFeatureChipSelect(ruleSetting.settingEl.createDiv({ cls: 'synapse-exclusion-chips' }), {
		value: rule.features,
		labels: FEATURE_LABELS,
		order: FEATURE_ORDER,
		onChange: (next) => {
			plugin.settings.exclusions[index].features = next;
			void plugin.saveSettings();
		},
	});
}

/**
 * Exclusions — vault paths hidden from some or all features (#307/#328). Adding
 * or removing a rule re-renders the tab; scope edits redraw only their chip row.
 */
export function renderExclusions(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	const body = ctx.configSection('exclusions', 'Exclusions');

	body.createDiv({
		cls: 'setting-item-description synapse-accordion-empty-note',
		text:
			'Paths listed here are skipped by the selected features. Patterns are vault-relative globs: ' +
			'"folder/**" (folder and everything under it), "folder/*" (direct children only), ' +
			'or an exact note path. ".synapse" (plugin data) and "templates" are excluded from every feature by default.',
	});

	const rules = plugin.settings.exclusions;

	if (rules.length === 0) {
		body.createDiv({
			cls: 'setting-item-description',
			text: 'No exclusions configured.',
		});
	}

	rules.forEach((rule, index) => {
		renderExclusionRule(ctx, body, rule, index);
	});

	// Scope edits on the add rows must not re-render (that would wipe the pending text input).
	let pendingFolderScope: 'all' | FeatureId[] = 'all';
	const folderSetting = new Setting(body)
		.setName('Add a folder')
		.setDesc('Pick a folder to exclude (saved as "folder/**"). The chips below set which features it is excluded from.')
		.addButton((btn) =>
			btn
				.setButtonText('Choose folder')
				.onClick(() => {
					new FolderPickerModal(plugin.app, (folder) => {
						const pattern = folder.isRoot() ? '/**' : `${folder.path}/**`;
						if (!plugin.settings.exclusions.some((r) => r.pattern === pattern)) {
							plugin.settings.exclusions.push({ pattern, features: pendingFolderScope });
						}
						void plugin.saveSettings().then(() => ctx.rerender());
					}).open();
				})
		);
	folderSetting.settingEl.addClass('synapse-setting--has-helper');
	renderFeatureChipSelect(folderSetting.settingEl.createDiv({ cls: 'synapse-exclusion-chips' }), {
		value: pendingFolderScope,
		labels: FEATURE_LABELS,
		order: FEATURE_ORDER,
		onChange: (next) => {
			pendingFolderScope = next;
		},
	});

	let pendingPattern = '';
	let pendingPatternScope: 'all' | FeatureId[] = 'all';
	const patternSetting = new Setting(body)
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
					if (!plugin.settings.exclusions.some((r) => r.pattern === pattern)) {
						plugin.settings.exclusions.push({ pattern, features: pendingPatternScope });
					}
					void plugin.saveSettings().then(() => ctx.rerender());
				})
		);
	patternSetting.settingEl.addClass('synapse-setting--has-helper');
	renderFeatureChipSelect(patternSetting.settingEl.createDiv({ cls: 'synapse-exclusion-chips' }), {
		value: pendingPatternScope,
		labels: FEATURE_LABELS,
		order: FEATURE_ORDER,
		onChange: (next) => {
			pendingPatternScope = next;
		},
	});
}

/** General — cross-cutting preferences (#381, #365); one self-contained Setting per preference. */
export function renderGeneral(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	const body = ctx.configSection('general', 'General');

	new Setting(body)
		.setName('Auto-fold properties')
		.setDesc(
			'Collapse the Properties (frontmatter) panel when a note is opened. ' +
			'You can still expand it manually — this only sets the initial state.',
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.ui.autoFoldProperties)
				.onChange(async (value) => {
					plugin.settings.ui.autoFoldProperties = value;
					await plugin.saveSettings();
					foldActiveNoteProperties(plugin.app, value);
				}),
		);

	new Setting(body)
		.setName('Notify me about Synapse updates')
		.setDesc(
			'Show an in-app notice when a newer version of Synapse is available. ' +
			'Checked at most once a day; the notice links to Community plugins to update.',
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.updates.enableUpdateNotifications)
				.onChange(async (value) => {
					plugin.settings.updates.enableUpdateNotifications = value;
					await plugin.saveSettings();
				}),
		);
}

/**
 * About — support links (kept in sync with `manifest.json` fundingUrl and
 * `.github/FUNDING.yml`), the changelog link (#375), and the global reset-all (#420).
 */
export function renderAbout(ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
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

	const changelogLine = aboutBody.createDiv({ cls: 'setting-item-description' });
	changelogLine.createSpan({ text: 'See what changed across versions → ' });
	const changelogLink = changelogLine.createEl('a', {
		text: "What's new",
		cls: 'synapse-changelog-link',
		attr: { href: '#' },
	});
	changelogLink.addEventListener('click', (evt) => {
		evt.preventDefault();
		new ChangelogModal(plugin.app, plugin).open();
	});

	new Setting(aboutBody)
		.setName('Reset all settings')
		.setDesc(
			'Restore every Synapse setting to its shipped defaults, including your ' +
			'API keys. This cannot be undone. Your notes and proposals are not affected.',
		)
		.addButton((btn) =>
			btn
				.setButtonText('Reset all settings')
				.setWarning()
				.onClick(async () => {
					const confirmed = await new ConfirmModal(plugin.app, {
						title: 'Reset all settings?',
						message:
							'This restores every Synapse setting to its defaults, including ' +
							'your API keys, and cannot be undone. Your notes and proposals ' +
							'are not affected.',
						confirmLabel: 'Reset all settings',
					}).openAndConfirm();
					if (!confirmed) return;
					plugin.settings = applyResetAll(plugin.settings);
					await plugin.saveSettings();
					ctx.rerender();
				}),
		);
}
