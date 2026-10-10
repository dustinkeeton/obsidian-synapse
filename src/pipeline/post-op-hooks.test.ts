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
		illustrateNote: vi.fn().mockResolvedValue(undefined),
		remNote: vi.fn().mockResolvedValue(null),
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
		const { deps } = makeDeps((s) => {
			s.deepDive.autoEnrichOnAccept = false;
			s.deepDive.autoRemOnAccept = false;
		});
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

describe('buildPostOpHook — illustrate leg (#213)', () => {
	const ctx = { sourceUrls: ['https://example.com/a'], sourceImages: [{ url: 'https://example.com/a.jpg', pageUrl: 'https://example.com/a' }] };

	it('is not wired while illustrate is disabled, even with runAfter on', () => {
		const { deps } = makeDeps((s) => {
			s.enrichment.autoEnrich = false;
			s.title.checkAfterOperations = false;
			s.illustrate.runAfter.summarize = true;
		});
		expect(buildPostOpHook(deps, 'summarize')).toBeNull();
	});

	it.each([
		['elaboration', 'elaboration'],
		['audio', 'transcription'],
		['video', 'transcription'],
		['image', 'transcription'],
		['summarize', 'summarize'],
		['deep-dive', 'deepDive'],
		['enrichment', 'enrichment'],
	] as const)('runs after %s only when runAfter.%s is on, passing the context through', (source, key) => {
		const { deps, settings } = makeDeps((s) => { s.illustrate.enabled = true; });
		const hook = buildPostOpHook(deps, source)!;
		hook('n.md', ctx);
		expect(deps.illustrateNote).not.toHaveBeenCalled();
		settings.illustrate.runAfter[key] = true;
		hook('n.md', ctx);
		expect(deps.illustrateNote).toHaveBeenCalledWith('n.md', ctx);
	});

	it('reads the illustrate gate live after wiring', () => {
		const { deps, settings } = makeDeps((s) => { s.illustrate.enabled = true; s.illustrate.runAfter.elaboration = true; });
		const hook = buildPostOpHook(deps, 'elaboration')!;
		settings.illustrate.enabled = false;
		hook('n.md');
		expect(deps.illustrateNote).not.toHaveBeenCalled();
	});

	it('never chains enrichment or a title check after an enrichment accept', () => {
		const { deps } = makeDeps((s) => { s.illustrate.enabled = true; s.illustrate.runAfter.enrichment = true; });
		buildPostOpHook(deps, 'enrichment')!('n.md');
		expect(deps.enrich).not.toHaveBeenCalled();
		expect(deps.checkTitle).not.toHaveBeenCalled();
		expect(deps.illustrateNote).toHaveBeenCalledWith('n.md', undefined);
		expect(buildPostOpHook(makeDeps().deps, 'enrichment')).toBeNull();
	});

	it('keeps the deep-dive illustrate leg reachable when autoEnrichOnAccept is off', () => {
		const { deps } = makeDeps((s) => {
			s.deepDive.autoEnrichOnAccept = false;
			s.illustrate.enabled = true;
			s.illustrate.runAfter.deepDive = true;
		});
		const hook = buildPostOpHook(deps, 'deep-dive')!;
		hook('d.md', ctx);
		expect(deps.enrich).not.toHaveBeenCalled();
		expect(deps.checkTitle).not.toHaveBeenCalled();
		expect(deps.illustrateNote).toHaveBeenCalledWith('d.md', ctx);
	});

	it('runs the enrich leg and the illustrate leg independently', () => {
		const { deps } = makeDeps((s) => { s.illustrate.enabled = true; s.illustrate.runAfter.transcription = true; });
		buildPostOpHook(deps, 'audio')!('a.md', ctx);
		expect(deps.enrich).toHaveBeenCalledWith('a.md', 'transcription');
		expect(deps.illustrateNote).toHaveBeenCalledWith('a.md', ctx);
	});
});

describe('buildPostOpHook deep-dive REM leg (#581)', () => {
	it('is wired by default', () => {
		const { deps } = makeDeps();
		buildPostOpHook(deps, 'deep-dive')!('n.md');
		expect(deps.remNote).toHaveBeenCalledWith('n.md');
	});

	it('is not wired when autoRemOnAccept is off', () => {
		const { deps } = makeDeps((s) => { s.deepDive.autoRemOnAccept = false; });
		buildPostOpHook(deps, 'deep-dive')!('n.md');
		expect(deps.remNote).not.toHaveBeenCalled();
	});

	it('REM-scans the accepted note when autoRemOnAccept is on', () => {
		const { deps } = makeDeps((s) => { s.deepDive.autoRemOnAccept = true; });
		buildPostOpHook(deps, 'deep-dive')!('n.md');
		expect(deps.remNote).toHaveBeenCalledWith('n.md');
		expect(deps.enrich).toHaveBeenCalledWith('n.md', 'deep-dive');
	});

	it('runs independently of the enrich/title chain', () => {
		const { deps } = makeDeps((s) => {
			s.deepDive.autoRemOnAccept = true;
			s.deepDive.autoEnrichOnAccept = false;
			s.illustrate.enabled = false;
		});
		buildPostOpHook(deps, 'deep-dive')!('n.md');
		expect(deps.remNote).toHaveBeenCalledWith('n.md');
		expect(deps.enrich).not.toHaveBeenCalled();
	});

	it('is not wired when REM is disabled', () => {
		const { deps } = makeDeps((s) => {
			s.deepDive.autoRemOnAccept = true;
			s.rem.enabled = false;
		});
		buildPostOpHook(deps, 'deep-dive')!('n.md');
		expect(deps.remNote).not.toHaveBeenCalled();
	});

	it.each(['elaboration', 'audio', 'summarize', 'enrichment'] as const)('is never wired for %s', (source) => {
		const { deps } = makeDeps((s) => { s.deepDive.autoRemOnAccept = true; });
		buildPostOpHook(deps, source)?.('n.md');
		expect(deps.remNote).not.toHaveBeenCalled();
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
