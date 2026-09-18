import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Platform } from '../__mocks__/obsidian';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { NoteOperationQueue } from '../shared';
import type { ModuleDeps } from '../shared';
import { createMockCheckpointManager, createMockPlugin, makeSettings } from '../__test-utils__/mock-factories';
import {
	MODULE_FACTORIES,
	constructFeatureModules,
	listFeatureModules,
	loadFeatureModules,
	unloadFeatureModules,
} from './registry';
import type { FeatureModuleKey, ModuleWiring } from './registry';

const SRC_DIR = join(process.cwd(), 'src');

function barrelModuleClasses(): string[] {
	const names: string[] = [];
	for (const dir of readdirSync(SRC_DIR)) {
		const barrel = join(SRC_DIR, dir, 'index.ts');
		if (!statSync(join(SRC_DIR, dir)).isDirectory() || !existsSync(barrel)) continue;
		const match = /^export class (\w+Module)\b/m.exec(readFileSync(barrel, 'utf8'));
		if (match) names.push(match[1]);
	}
	return names.sort();
}

function build(overrides?: Partial<SynapseSettings>) {
	const settings = makeSettings(DEFAULT_SETTINGS, overrides);
	const deps: ModuleDeps = {
		plugin: createMockPlugin() as never,
		getSettings: () => settings,
		notifications: {} as never,
		checkpointManager: createMockCheckpointManager() as never,
		registrar: { register: vi.fn() } as never,
		noteQueue: new NoteOperationQueue(),
	};
	const wiring: ModuleWiring = {
		transcribeUrl: vi.fn(),
		intake: { fireOnFile: vi.fn(), transcribeUrlToNote: vi.fn() },
	};
	return { settings, wiring, modules: constructFeatureModules(deps, wiring) };
}

describe('module registry', () => {
	afterEach(() => {
		Platform.isDesktop = true;
	});

	it('constructs every feature module class declared in a src/<feature>/index.ts barrel', () => {
		const { modules } = build();
		const constructed = listFeatureModules(modules).map((m) => m.constructor.name).sort();
		expect(constructed).toEqual(barrelModuleClasses());
	});

	it('keys the constructed record by the registry entries in registry order', () => {
		const { modules } = build();
		expect(Object.keys(modules)).toEqual(MODULE_FACTORIES.map((entry) => entry.key));
	});

	it('gates video on the desktop platform predicate', () => {
		Platform.isDesktop = false;
		const { modules } = build();
		expect(modules.video).toBeNull();
		expect(listFeatureModules(modules).map((m) => m.constructor.name)).not.toContain('VideoModule');
	});

	it('hands the routed URL transcriber to video', () => {
		const { modules, wiring } = build();
		expect(modules.video?.urlTranscriber).toBe(wiring.transcribeUrl);
	});

	it('hands summarize the routed transcript with its cache flags intact (#527)', async () => {
		const { modules, wiring } = build();
		const routed = { text: 'transcript', cached: true };
		vi.mocked(wiring.transcribeUrl).mockResolvedValue(routed);
		const { transcribeUrl } = modules.summarize as unknown as {
			transcribeUrl: (url: string) => Promise<unknown>;
		};
		expect(await transcribeUrl('https://youtu.be/abc')).toBe(routed);
	});

	it('loads only modules whose settings section is enabled, in registry order', async () => {
		const { modules, settings } = build({
			audio: { ...DEFAULT_SETTINGS.audio, enabled: false },
			tidy: { ...DEFAULT_SETTINGS.tidy, enabled: false },
		});
		const loaded: FeatureModuleKey[] = [];
		for (const entry of MODULE_FACTORIES) {
			const module = modules[entry.key];
			if (module) vi.spyOn(module, 'onload').mockImplementation(async () => { loaded.push(entry.key); });
		}
		await loadFeatureModules(modules, settings);
		expect(loaded).toEqual(MODULE_FACTORIES.map((e) => e.key).filter((k) => k !== 'audio' && k !== 'tidy'));
	});

	it('unloads every constructed module in reverse registry order', () => {
		const { modules } = build();
		const unloaded: FeatureModuleKey[] = [];
		for (const entry of MODULE_FACTORIES) {
			const module = modules[entry.key];
			if (module) vi.spyOn(module, 'onunload').mockImplementation(() => { unloaded.push(entry.key); });
		}
		unloadFeatureModules(modules);
		expect(unloaded).toEqual([...MODULE_FACTORIES.map((e) => e.key)].reverse());
	});

	it('exposes proposal-sidebar hook slots only on the proposal modules', () => {
		const { modules } = build();
		const withSlots = listFeatureModules(modules)
			.filter((m) => m.onOpenProposalView !== undefined && m.onViewRefreshNeeded !== undefined)
			.map((m) => m.constructor.name)
			.sort();
		expect(withSlots).toEqual(
			['DeepDiveModule', 'ElaborationModule', 'EnrichmentModule', 'OrganizeModule', 'RemModule', 'TitleModule']
		);
	});
});
