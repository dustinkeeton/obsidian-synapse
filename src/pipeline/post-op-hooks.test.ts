import { describe, it, expect, vi } from 'vitest';
import { buildPostOpHook, buildAutoOrganizeHook } from './post-op-hooks';
import type { PostOpHookDeps } from './post-op-hooks';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { TFile } from '../__mocks__/obsidian';
import type { TFile as ObsidianTFile } from 'obsidian';
import type { NotificationManager } from '../shared';

function makeDeps(mutate: (s: SynapseSettings) => void = () => {}) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate(settings);
	const deps: PostOpHookDeps = {
		getSettings: () => settings,
		notifications: { notifyError: vi.fn() } as unknown as NotificationManager,
		enrich: vi.fn().mockResolvedValue(undefined),
		checkTitle: vi.fn().mockResolvedValue(undefined),
		organizeNote: vi.fn().mockResolvedValue(null),
	};
	return { deps, settings };
}

describe('buildPostOpHook', () => {
	it('chains enrichment with the source-specific trigger and a title check', () => {
		const { deps } = makeDeps();
		const hook = buildPostOpHook(deps, 'audio');
		expect(hook).not.toBeNull();
		hook!('a.md');
		expect(deps.enrich).toHaveBeenCalledWith('a.md', 'transcription');
		expect(deps.checkTitle).toHaveBeenCalledWith('a.md');
	});

	it.each([
		['elaboration', 'elaboration'],
		['video', 'transcription'],
		['image', 'transcription'],
		['summarize', 'summarization'],
		['deep-dive', 'deep-dive'],
	] as const)('maps %s to trigger %s', (source, trigger) => {
		const { deps } = makeDeps();
		buildPostOpHook(deps, source)!('n.md');
		expect(deps.enrich).toHaveBeenCalledWith('n.md', trigger);
	});

	it('reads the title gate live under auto-enrich', () => {
		const { deps, settings } = makeDeps();
		const hook = buildPostOpHook(deps, 'elaboration')!;
		settings.title.checkAfterOperations = false;
		hook('a.md');
		expect(deps.enrich).toHaveBeenCalledTimes(1);
		expect(deps.checkTitle).not.toHaveBeenCalled();
	});

	it('returns null for deep-dive when autoEnrichOnAccept is off under auto-enrich', () => {
		const { deps } = makeDeps((s) => { s.deepDive.autoEnrichOnAccept = false; });
		expect(buildPostOpHook(deps, 'deep-dive')).toBeNull();
		expect(buildPostOpHook(deps, 'audio')).not.toBeNull();
	});

	it('wires a standalone title check when auto-enrich is off', () => {
		const { deps } = makeDeps((s) => { s.enrichment.autoEnrich = false; });
		const hook = buildPostOpHook(deps, 'deep-dive');
		hook!('a.md');
		expect(deps.enrich).not.toHaveBeenCalled();
		expect(deps.checkTitle).toHaveBeenCalledWith('a.md');
	});

	it('wires a standalone title check when enrichment is disabled', () => {
		const { deps } = makeDeps((s) => { s.enrichment.enabled = false; });
		buildPostOpHook(deps, 'summarize')!('a.md');
		expect(deps.enrich).not.toHaveBeenCalled();
		expect(deps.checkTitle).toHaveBeenCalledWith('a.md');
	});

	it('returns null when neither enrichment nor title checks apply', () => {
		const { deps } = makeDeps((s) => {
			s.enrichment.autoEnrich = false;
			s.title.checkAfterOperations = false;
		});
		expect(buildPostOpHook(deps, 'audio')).toBeNull();
	});

	it('returns null when title is disabled and enrichment is off', () => {
		const { deps } = makeDeps((s) => {
			s.enrichment.enabled = false;
			s.title.enabled = false;
		});
		expect(buildPostOpHook(deps, 'elaboration')).toBeNull();
	});
});

describe('buildAutoOrganizeHook', () => {
	const file = new TFile('n.md') as unknown as ObsidianTFile;

	it('is null by default (both triggers opt in)', () => {
		const { deps } = makeDeps();
		expect(buildAutoOrganizeHook(deps, 'deep-dive')).toBeNull();
		expect(buildAutoOrganizeHook(deps, 'summarize')).toBeNull();
	});

	it('organizes on deep-dive accept when opted in', () => {
		const { deps } = makeDeps((s) => { s.deepDive.autoOrganizeOnAccept = true; });
		buildAutoOrganizeHook(deps, 'deep-dive')!(file);
		expect(deps.organizeNote).toHaveBeenCalledWith(file);
		expect(buildAutoOrganizeHook(deps, 'summarize')).toBeNull();
	});

	it('organizes after summarize when opted in', () => {
		const { deps } = makeDeps((s) => { s.summarize.autoOrganizeOnSummarize = true; });
		buildAutoOrganizeHook(deps, 'summarize')!(file);
		expect(deps.organizeNote).toHaveBeenCalledWith(file);
	});

	it('is null when organize is disabled', () => {
		const { deps } = makeDeps((s) => {
			s.organize.enabled = false;
			s.deepDive.autoOrganizeOnAccept = true;
			s.summarize.autoOrganizeOnSummarize = true;
		});
		expect(buildAutoOrganizeHook(deps, 'deep-dive')).toBeNull();
		expect(buildAutoOrganizeHook(deps, 'summarize')).toBeNull();
	});
});
