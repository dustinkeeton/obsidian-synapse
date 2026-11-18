import type { AIFeatureId, AIProvider, KeyedProvider, SynapseSettings } from '../settings';
import { AI_FEATURE_IDS, resolveAIConfig, transcriptionKeyProvider } from '../shared';
import type { FeatureSettingsKey } from '../shared';
import type { FeatureModules } from '../modules';
import type { ApiAIStatus, ApiFeatureCapability, ApiKeySource, ApiStatus, SynapseApiDeps } from './types';
import { API_VERSION } from './types';

/** Where a vendor's key comes from; never the key itself. */
export function keySourceFor(settings: SynapseSettings, provider: KeyedProvider | AIProvider | undefined): ApiKeySource {
	if (provider === undefined || provider === 'ollama') return 'local';
	if (provider === settings.ai.provider) return settings.ai.apiKey ? 'default-key' : 'missing';
	return settings.ai.providerKeys?.[provider] ? 'provider-key' : 'missing';
}

export function aiStatus(settings: SynapseSettings, feature: AIFeatureId): ApiAIStatus {
	const config = resolveAIConfig(settings, feature);
	return {
		provider: config.provider,
		model: config.model,
		effort: config.effort ?? null,
		keySource: keySourceFor(settings, config.provider),
	};
}

function transcriptionKeySource(settings: SynapseSettings): ApiKeySource {
	return keySourceFor(settings, transcriptionKeyProvider(settings.audio.transcriptionProvider));
}

function featureKeys(modules: FeatureModules): FeatureSettingsKey[] {
	return Object.keys(modules) as FeatureSettingsKey[];
}

/** The AI feature id a settings section calls with, when it makes model calls under its own id. */
function aiFeatureOf(key: FeatureSettingsKey): AIFeatureId | null {
	const id = key === 'deepDive' ? 'deep-dive' : key;
	return (AI_FEATURE_IDS as readonly string[]).includes(id) ? id as AIFeatureId : null;
}

function keyReady(settings: SynapseSettings, key: FeatureSettingsKey): boolean | null {
	if (key === 'audio' || key === 'video') return transcriptionKeySource(settings) !== 'missing';
	const feature = aiFeatureOf(key);
	return feature ? aiStatus(settings, feature).keySource !== 'missing' : null;
}

export function featureCapabilities(
	settings: SynapseSettings,
	modules: FeatureModules
): Record<FeatureSettingsKey, ApiFeatureCapability> {
	const result = {} as Record<FeatureSettingsKey, ApiFeatureCapability>;
	for (const key of featureKeys(modules)) {
		result[key] = { enabled: settings[key].enabled, available: modules[key] !== null, keyReady: keyReady(settings, key) };
	}
	return result;
}

export async function buildStatus(deps: SynapseApiDeps): Promise<ApiStatus> {
	const settings = deps.getSettings();
	const features = {} as ApiStatus['features'];
	for (const key of featureKeys(deps.modules)) {
		features[key] = { enabled: settings[key].enabled, available: deps.modules[key] !== null };
	}
	const ai = {} as ApiStatus['ai'];
	for (const feature of AI_FEATURE_IDS) ai[feature] = aiStatus(settings, feature);
	const checkpoints = await deps.checkpointManager.listIncomplete().catch(() => null);
	return {
		apiVersion: API_VERSION,
		pluginVersion: deps.pluginVersion,
		settingsVersion: settings.settingsVersion,
		features,
		ai,
		transcription: {
			provider: settings.audio.transcriptionProvider,
			model: settings.audio.transcriptionModel,
			keySource: transcriptionKeySource(settings),
		},
		systemOne: {
			enabled: settings.ai.systemOne.enabled,
			model: settings.ai.systemOne.model,
			keySource: settings.ai.systemOne.apiKey ? 'provider-key' : 'missing',
		},
		inProgress: deps.notifications.inProgress.snapshot(),
		checkpoints: checkpoints?.map((cp) => ({
			id: cp.id,
			module: cp.module,
			label: cp.operationLabel,
			completed: cp.completedItems.length,
			remaining: cp.remainingItems.length,
			updatedAt: cp.updatedAt,
		})) ?? null,
	};
}
