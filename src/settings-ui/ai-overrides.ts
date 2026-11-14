import { Setting } from 'obsidian';
import { MODEL_OPTIONS } from '../settings';
import type { AIFeatureId, AIModelOverride, AIProvider, EffortLevel, KeyedProvider, SynapseSettings } from '../settings';
import { renderTranscriptionSetting } from '../audio';
import {
	AI_FEATURE_IDS,
	effortFor,
	effortStepsFor,
	PROVIDER_METADATA,
	aiOverrideFor,
	decorateCredentialField,
	extraProviders,
} from '../shared';
import type { CredentialFieldHandle, SettingsSectionContext } from '../shared';

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	gemini: 'Google Gemini',
	ollama: 'Ollama (Local)',
};

const KEY_LABELS: Record<KeyedProvider, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	gemini: 'Google Gemini',
	deepgram: 'Deepgram',
};

const AI_FEATURE_LABELS: Record<AIFeatureId, string> = {
	elaboration: 'Elaboration',
	enrichment: 'Enrichment',
	summarize: 'Summarize',
	tidy: 'Tidy',
	organize: 'Organize',
	'deep-dive': 'Deep dive',
	title: 'Title',
	rem: 'REM (link discovery)',
	illustrate: 'Illustrate',
	audio: 'Transcript post-processing',
	image: 'Image OCR and analysis',
};

const EFFORT_LABELS: Record<EffortLevel, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	max: 'Max',
};

/** Dropdown value meaning "use the default" (provider/model, or no effort field). */
export const DEFAULT_CHOICE = '';

/** Effort dropdown options for a model, or `undefined` when it takes no effort parameter. */
export function effortChoiceOptions(provider: AIProvider, model: string): Record<string, string> | undefined {
	const steps = effortStepsFor(provider, model);
	if (steps.length === 0) return undefined;
	const options: Record<string, string> = { [DEFAULT_CHOICE]: 'Default' };
	for (const level of steps) options[level] = EFFORT_LABELS[level];
	return options;
}

/** A provider's listed models, plus a saved Ollama tag that is no longer listed (it keeps working). */
export function providerModelOptions(provider: AIProvider, saved?: string): Record<string, string> {
	const listed = MODEL_OPTIONS[provider];
	if (provider !== 'ollama' || !saved || saved in listed) return listed;
	return { ...listed, [saved]: saved };
}

/** Effort is not part of the encoded choice; it has its own dropdown. */
export function encodeModelChoice(override: AIModelOverride | undefined): string {
	return override ? `${override.provider}:${override.model}` : DEFAULT_CHOICE;
}

/** Inverse of {@link encodeModelChoice}; returns `undefined` for the default or an unknown choice. */
export function decodeModelChoice(value: string): AIModelOverride | undefined {
	const sep = value.indexOf(':');
	if (sep < 0) return undefined;
	const provider = value.slice(0, sep) as AIProvider;
	const model = value.slice(sep + 1);
	if (!(provider in MODEL_OPTIONS) || !model) return undefined;
	if (provider !== 'ollama' && !(model in MODEL_OPTIONS[provider])) return undefined;
	return { provider, model };
}

function choiceLabel(provider: AIProvider, model: string): string {
	return `${AI_PROVIDER_LABELS[provider]} · ${MODEL_OPTIONS[provider][model] ?? model}`;
}

/** Every provider/model pair, preceded by the "Default (…)" entry. */
export function modelChoiceOptions(settings: SynapseSettings): Record<string, string> {
	const options: Record<string, string> = {
		[DEFAULT_CHOICE]: `Default (${choiceLabel(settings.ai.provider, settings.ai.model)})`,
	};
	for (const provider of Object.keys(MODEL_OPTIONS) as AIProvider[]) {
		for (const model of Object.keys(MODEL_OPTIONS[provider])) {
			options[encodeModelChoice({ provider, model })] = choiceLabel(provider, model);
		}
	}
	for (const feature of AI_FEATURE_IDS) {
		const override = aiOverrideFor(settings, feature);
		if (override?.provider === 'ollama') {
			options[encodeModelChoice(override)] ??= choiceLabel('ollama', override.model);
		}
	}
	return options;
}

/** Return new settings maps (never mutate in place: untouched merged defaults are shared by reference). */
export function withOverride(
	overrides: SynapseSettings['ai']['overrides'],
	feature: AIFeatureId,
	override: AIModelOverride | undefined,
): SynapseSettings['ai']['overrides'] {
	const next = { ...overrides };
	if (override) {
		const { effort, ...rest } = override;
		next[feature] = effort ? { ...rest, effort } : rest;
	}
	else delete next[feature];
	return next;
}

/** Ollama endpoints must be HTTPS, or HTTP on localhost; ai-client enforces the same rule at call time. */
export function isAllowedOllamaEndpoint(value: string): boolean {
	try {
		const parsed = new URL(value);
		const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
		return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocal);
	} catch {
		return false;
	}
}

/** Transcription and per-feature provider/model rows, plus a key row for each extra vendor they use. */
export function renderAiOverrides(parent: HTMLElement, ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	new Setting(parent)
		.setName('Per-feature models')
		.setDesc('Choose a different provider, model and effort for any feature. Features left on default use the settings above.')
		.setHeading();

	renderTranscriptionSetting(parent, ctx);

	const options = modelChoiceOptions(plugin.settings);
	for (const feature of AI_FEATURE_IDS) {
		const override = aiOverrideFor(plugin.settings, feature);
		const row = new Setting(parent)
			.setName(AI_FEATURE_LABELS[feature])
			.addDropdown((dd) => {
				dd.addOptions(options);
				const current = encodeModelChoice(override);
				dd.setValue(current in options ? current : DEFAULT_CHOICE);
				dd.onChange(async (value) => {
					const next = decodeModelChoice(value);
					if (next) next.effort = effortFor(next.provider, next.model, override?.effort);
					plugin.settings.ai.overrides = withOverride(plugin.settings.ai.overrides, feature, next);
					await plugin.saveSettings();
					ctx.rerender();
				});
			});
		const efforts = override && effortChoiceOptions(override.provider, override.model);
		if (override && efforts) {
			row.addDropdown((dd) => {
				dd.addOptions(efforts);
				const current = override.effort ?? DEFAULT_CHOICE;
				dd.setValue(current in efforts ? current : DEFAULT_CHOICE);
				dd.onChange(async (value) => {
					const effort = value === DEFAULT_CHOICE ? undefined : (value as EffortLevel);
					plugin.settings.ai.overrides = withOverride(plugin.settings.ai.overrides, feature, { ...override, effort });
					await plugin.saveSettings();
				});
			});
		}
	}

	for (const provider of extraProviders(plugin.settings)) {
		if (provider === 'ollama') {
			renderOllamaEndpoint(parent, ctx);
			continue;
		}
		const cred = provider;
		let field: CredentialFieldHandle | undefined;
		const setting = new Setting(parent)
			.setName(`${KEY_LABELS[provider]} API key`)
			.setDesc('Used by the features above that you set to this provider.')
			.addText((text) => {
				text
					.setPlaceholder(PROVIDER_METADATA[cred].placeholder)
					.setValue(plugin.settings.ai.providerKeys?.[provider] ?? '')
					.onChange(async (value) => {
						plugin.settings.ai.providerKeys = { ...plugin.settings.ai.providerKeys, [provider]: value };
						await plugin.saveSettings();
						field?.reset();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
			});
		field = decorateCredentialField({
			setting,
			provider: cred,
			getKey: () => plugin.settings.ai.providerKeys?.[provider] ?? '',
		});
	}
}

/** Ollama endpoint row; shared by the default-provider block and the per-feature key rows. */
export function renderOllamaEndpoint(parent: HTMLElement, ctx: SettingsSectionContext): void {
	const { plugin } = ctx;
	let field: CredentialFieldHandle | undefined;
	const setting = new Setting(parent)
		.setName('Ollama endpoint')
		.setDesc('URL for local Ollama server (HTTPS required for non-localhost)')
		.addText((text) =>
			text
				.setPlaceholder(PROVIDER_METADATA.ollama.placeholder)
				.setValue(plugin.settings.ai.ollamaEndpoint)
				.onChange(async (value) => {
					if (!isAllowedOllamaEndpoint(value)) return;
					plugin.settings.ai.ollamaEndpoint = value;
					await plugin.saveSettings();
					field?.reset();
				})
		);
	field = decorateCredentialField({
		setting,
		provider: 'ollama',
		getKey: () => '',
		getEndpoint: () => plugin.settings.ai.ollamaEndpoint,
	});
}
