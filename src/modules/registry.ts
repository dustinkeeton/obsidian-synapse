import { Platform } from 'obsidian';
import type { SynapseSettings, AutoAcceptSettings } from '../settings';
import type { ModuleDeps, FeatureModule, FeatureSettingsKey } from '../shared';
import { ElaborationModule } from '../elaboration';
import { AudioModule } from '../audio';
import { VideoModule, AudioExtractor } from '../video';
import type { RoutedUrlTranscriber } from '../video';
import { ImageModule } from '../image';
import { EnrichmentModule } from '../enrichment';
import { SummarizeModule } from '../summarize';
import { TidyModule } from '../tidy';
import { OrganizeModule } from '../organize';
import { DeepDiveModule } from '../deep-dive';
import { TitleModule } from '../title';
import { RemModule } from '../rem';
import { IntakeModule } from '../intake';
import type { IntakeDeps } from '../intake';

interface FeatureModuleClasses {
	elaboration: ElaborationModule;
	audio: AudioModule;
	video: VideoModule | null;
	image: ImageModule;
	enrichment: EnrichmentModule;
	summarize: SummarizeModule;
	tidy: TidyModule;
	organize: OrganizeModule;
	deepDive: DeepDiveModule;
	title: TitleModule;
	rem: RemModule;
	intake: IntakeModule;
}

/** One slot per `enabled`-flagged settings section; a platform-gated slot is null where its predicate fails. */
export type FeatureModules = { [K in FeatureSettingsKey]: FeatureModuleClasses[K] };
export type FeatureModuleKey = keyof FeatureModules;

/** Cross-module callbacks main.ts resolves after construction (URL router, pipeline runner). */
export interface ModuleWiring {
	transcribeUrl: RoutedUrlTranscriber;
	intake: IntakeDeps;
}

export interface ModuleFactoryContext {
	deps: ModuleDeps;
	/** Modules constructed by earlier registry entries. */
	built: Readonly<Partial<FeatureModules>>;
	wiring: ModuleWiring;
}

export type ModuleEntry = {
	[K in FeatureModuleKey]: {
		key: K;
		/** Omitted = every platform; false skips construction and leaves the slot null. */
		platform?: () => boolean;
		create: (ctx: ModuleFactoryContext) => NonNullable<FeatureModules[K]>;
	};
}[FeatureModuleKey];

function autoAccept(deps: ModuleDeps, kind: keyof AutoAcceptSettings): () => boolean {
	return () => deps.getSettings().autoAccept[kind];
}

function builtModule<K extends FeatureModuleKey>(
	built: Readonly<Partial<FeatureModules>>,
	key: K
): NonNullable<FeatureModules[K]> {
	const module = built[key];
	if (!module) throw new Error(`[Synapse] module registry: "${key}" must be constructed before its dependents`);
	return module;
}

/** Construction/load order; unload walks it in reverse. Video depends on audio, so audio precedes it. */
export const MODULE_FACTORIES: readonly ModuleEntry[] = [
	{ key: 'elaboration', create: ({ deps }) => new ElaborationModule(deps, autoAccept(deps, 'elaboration')) },
	{
		key: 'audio',
		create: ({ deps }) => new AudioModule(deps, Platform.isDesktop ? new AudioExtractor(deps.getSettings) : undefined),
	},
	{
		key: 'video',
		platform: () => Platform.isDesktop,
		create: ({ deps, built, wiring }) => {
			const video = new VideoModule(deps, builtModule(built, 'audio'));
			video.urlTranscriber = wiring.transcribeUrl;
			return video;
		},
	},
	{ key: 'image', create: ({ deps }) => new ImageModule(deps) },
	{ key: 'enrichment', create: ({ deps }) => new EnrichmentModule(deps, autoAccept(deps, 'enrichment')) },
	{
		key: 'summarize',
		create: ({ deps, built, wiring }) => {
			const audio = builtModule(built, 'audio');
			return new SummarizeModule(
				deps,
				async (url, parentOp) => (await wiring.transcribeUrl(url, parentOp)).text,
				async (audioFile) => {
					const data = await deps.plugin.app.vault.readBinary(audioFile);
					const result = await audio.transcribe(data, audioFile.name);
					return result.processed || result.raw;
				}
			);
		},
	},
	{ key: 'tidy', create: ({ deps }) => new TidyModule(deps) },
	{ key: 'organize', create: ({ deps }) => new OrganizeModule(deps, autoAccept(deps, 'organize')) },
	{ key: 'deepDive', create: ({ deps }) => new DeepDiveModule(deps, autoAccept(deps, 'deep-dive')) },
	{ key: 'title', create: ({ deps }) => new TitleModule(deps, autoAccept(deps, 'title')) },
	{ key: 'rem', create: ({ deps }) => new RemModule(deps, autoAccept(deps, 'rem')) },
	{ key: 'intake', create: ({ deps, wiring }) => new IntakeModule(deps, wiring.intake) },
];

function assignSlot<K extends FeatureModuleKey>(built: Partial<FeatureModules>, key: K, module: FeatureModules[K]): void {
	built[key] = module;
}

/** Construct every registry entry in order; disabled modules are constructed too and only skipped at load. */
export function constructFeatureModules(deps: ModuleDeps, wiring: ModuleWiring): FeatureModules {
	const built: Partial<FeatureModules> = {};
	for (const entry of MODULE_FACTORIES) {
		const available = entry.platform?.() ?? true;
		assignSlot(built, entry.key, available ? entry.create({ deps, built, wiring }) : null);
	}
	return built as FeatureModules;
}

/** Constructed modules in registry order, platform-gated nulls omitted. */
export function listFeatureModules(modules: FeatureModules): FeatureModule[] {
	return MODULE_FACTORIES
		.map((entry) => modules[entry.key])
		.filter((module): module is NonNullable<typeof module> => module !== null);
}

export async function loadFeatureModules(modules: FeatureModules, settings: SynapseSettings): Promise<void> {
	for (const entry of MODULE_FACTORIES) {
		const module = modules[entry.key];
		if (module && settings[entry.key].enabled) await module.onload();
	}
}

export function unloadFeatureModules(modules: FeatureModules): void {
	for (let i = MODULE_FACTORIES.length - 1; i >= 0; i--) {
		modules[MODULE_FACTORIES[i].key]?.onunload();
	}
}
