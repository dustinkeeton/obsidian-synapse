import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SynapseRunner } from './synapse-runner';
import { DEFAULT_SETTINGS } from '../settings';
import type { PipelineModuleMap } from './types';
import { TFile, TFolder } from '../__mocks__/obsidian';

function createMockNotifications() {
	const handle = {
		update: vi.fn(),
		progress: vi.fn(),
		finish: vi.fn(),
		error: vi.fn(),
		cancelled: false,
	};
	return {
		startOperation: vi.fn().mockReturnValue(handle),
		info: vi.fn(),
		success: vi.fn(),
		notifyError: vi.fn(),
		_handle: handle,
	};
}

function createMockModules(): PipelineModuleMap {
	return {
		elaboration: vi.fn().mockResolvedValue(3),
		summarize: vi.fn().mockResolvedValue(undefined),
		enrichment: vi.fn().mockResolvedValue(5),
		rem: vi.fn().mockResolvedValue(2),
		tidy: vi.fn().mockResolvedValue(4),
		organize: vi.fn().mockResolvedValue(1),
	};
}

describe('SynapseRunner', () => {
	let runner: SynapseRunner;
	let mockModules: PipelineModuleMap;
	let mockNotifications: ReturnType<typeof createMockNotifications>;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.elaboration.enabled = true;
		settings.summarize.enabled = true;
		settings.enrichment.enabled = true;
		settings.rem.enabled = true;
		settings.tidy.enabled = true;
		settings.organize.enabled = true;

		mockModules = createMockModules();
		mockNotifications = createMockNotifications();

		runner = new SynapseRunner(
			mockModules,
			() => settings,
			mockNotifications as any,
		);
	});

	it('runs all enabled phases in correct order', async () => {
		const callOrder: string[] = [];
		(mockModules.elaboration as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push('elaboration');
			return Promise.resolve(0);
		});
		(mockModules.summarize as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push('summarize');
			return Promise.resolve();
		});
		(mockModules.enrichment as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push('enrichment');
			return Promise.resolve(0);
		});
		(mockModules.rem as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push('rem');
			return Promise.resolve(0);
		});
		(mockModules.tidy as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push('tidy');
			return Promise.resolve(0);
		});
		(mockModules.organize as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callOrder.push('organize');
			return Promise.resolve(0);
		});

		await runner.fire('/test/folder');

		expect(callOrder).toEqual([
			'elaboration',
			'summarize',
			'enrichment',
			'rem',
			'tidy',
			'organize',
		]);
	});

	it('skips disabled modules', async () => {
		settings.summarize.enabled = false;
		settings.rem.enabled = false;
		settings.tidy.enabled = false;

		await runner.fire();

		expect(mockModules.elaboration).toHaveBeenCalled();
		expect(mockModules.summarize).not.toHaveBeenCalled();
		expect(mockModules.enrichment).toHaveBeenCalled();
		expect(mockModules.rem).not.toHaveBeenCalled();
		expect(mockModules.tidy).not.toHaveBeenCalled();
		expect(mockModules.organize).toHaveBeenCalled();
	});

	it('handles zero enabled modules', async () => {
		settings.elaboration.enabled = false;
		settings.summarize.enabled = false;
		settings.enrichment.enabled = false;
		settings.rem.enabled = false;
		settings.tidy.enabled = false;
		settings.organize.enabled = false;

		await runner.fire();

		expect(mockNotifications.info).toHaveBeenCalledWith('No features are enabled');
		expect(mockNotifications.startOperation).not.toHaveBeenCalled();
	});

	it('passes folderPath to each module', async () => {
		await runner.fire('/my/folder');

		expect(mockModules.elaboration).toHaveBeenCalledWith('/my/folder', true);
		expect(mockModules.summarize).toHaveBeenCalledWith('/my/folder', true);
		expect(mockModules.enrichment).toHaveBeenCalledWith('/my/folder', true);
		expect(mockModules.rem).toHaveBeenCalledWith('/my/folder', true);
		expect(mockModules.tidy).toHaveBeenCalledWith('/my/folder', true);
		expect(mockModules.organize).toHaveBeenCalledWith('/my/folder', true);
	});

	it('passes skipConfirmation=true to each module', async () => {
		await runner.fire();

		for (const key of Object.keys(mockModules) as (keyof PipelineModuleMap)[]) {
			expect(mockModules[key]).toHaveBeenCalledWith(undefined, true);
		}
	});

	it('pipeline cancellation stops at next phase boundary', async () => {
		let phaseCount = 0;
		(mockModules.elaboration as ReturnType<typeof vi.fn>).mockImplementation(() => {
			phaseCount++;
			return Promise.resolve(0);
		});
		(mockModules.summarize as ReturnType<typeof vi.fn>).mockImplementation(() => {
			phaseCount++;
			// Simulate cancellation after summarize completes
			mockNotifications._handle.cancelled = true;
			return Promise.resolve();
		});

		await runner.fire();

		expect(phaseCount).toBe(2);
		expect(mockModules.enrichment).not.toHaveBeenCalled();
		expect(mockModules.rem).not.toHaveBeenCalled();
		expect(mockModules.tidy).not.toHaveBeenCalled();
		expect(mockModules.organize).not.toHaveBeenCalled();
		// Should not call finish when cancelled
		expect(mockNotifications._handle.finish).not.toHaveBeenCalled();
	});

	it('phase error does not abort pipeline', async () => {
		(mockModules.enrichment as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('Enrichment exploded'),
		);

		await runner.fire();

		// Phases after the error still run
		expect(mockModules.rem).toHaveBeenCalled();
		expect(mockModules.tidy).toHaveBeenCalled();
		expect(mockModules.organize).toHaveBeenCalled();
		expect(mockNotifications._handle.finish).toHaveBeenCalledWith(
			expect.stringContaining('6 phases run'),
		);
	});

	it('progress reporting shows correct phase counts', async () => {
		settings.summarize.enabled = false;
		settings.rem.enabled = false;

		await runner.fire();

		// 4 enabled phases: elaboration, enrichment, tidy, organize
		expect(mockNotifications._handle.progress).toHaveBeenCalledWith(
			1, 4, 'Phase 1/4: Elaboration',
		);
		expect(mockNotifications._handle.progress).toHaveBeenCalledWith(
			2, 4, 'Phase 2/4: Enrichment',
		);
		expect(mockNotifications._handle.progress).toHaveBeenCalledWith(
			3, 4, 'Phase 3/4: Tidy',
		);
		expect(mockNotifications._handle.progress).toHaveBeenCalledWith(
			4, 4, 'Phase 4/4: Organize',
		);
		expect(mockNotifications._handle.finish).toHaveBeenCalledWith(
			'Fire Synapse complete — 4 phases run',
		);
	});

	describe('fireOnFile (per-note scoping, #111)', () => {
		// Returns `any`: the mock TFile is structurally compatible with the
		// real obsidian.TFile that fireOnFile expects, but its `vault: unknown`
		// trips strict assignability — the established pattern is to cast.
		function fileIn(folder: string, name: string): any {
			const file = new TFile(`${folder}/${name}`);
			file.parent = new TFolder(folder);
			return file;
		}

		it('runs each active phase exactly once for the file', async () => {
			const file = fileIn('Inbox', 'note.md');

			await runner.fireOnFile(file);

			for (const key of Object.keys(mockModules) as (keyof PipelineModuleMap)[]) {
				expect(mockModules[key]).toHaveBeenCalledTimes(1);
			}
		});

		it('scopes each phase to the file via parent folder + onlyFile', async () => {
			const file = fileIn('Inbox', 'note.md');

			await runner.fireOnFile(file);

			for (const key of Object.keys(mockModules) as (keyof PipelineModuleMap)[]) {
				expect(mockModules[key]).toHaveBeenCalledWith('Inbox', true, file);
			}
		});

		it('passes undefined folderPath for a root-level note', async () => {
			const file: any = new TFile('note.md');
			file.parent = new TFolder('/'); // root

			await runner.fireOnFile(file);

			expect(mockModules.elaboration).toHaveBeenCalledWith(undefined, true, file);
		});

		it('respects phase enable filtering', async () => {
			settings.summarize.enabled = false;
			settings.tidy.enabled = false;
			const file = fileIn('Inbox', 'note.md');

			await runner.fireOnFile(file);

			expect(mockModules.elaboration).toHaveBeenCalledTimes(1);
			expect(mockModules.enrichment).toHaveBeenCalledTimes(1);
			expect(mockModules.rem).toHaveBeenCalledTimes(1);
			expect(mockModules.organize).toHaveBeenCalledTimes(1);
			expect(mockModules.summarize).not.toHaveBeenCalled();
			expect(mockModules.tidy).not.toHaveBeenCalled();
		});

		it('reports no features when all phases are disabled', async () => {
			settings.elaboration.enabled = false;
			settings.summarize.enabled = false;
			settings.enrichment.enabled = false;
			settings.rem.enabled = false;
			settings.tidy.enabled = false;
			settings.organize.enabled = false;
			const file = fileIn('Inbox', 'note.md');

			await runner.fireOnFile(file);

			expect(mockNotifications.info).toHaveBeenCalledWith('No features are enabled');
			expect(mockModules.elaboration).not.toHaveBeenCalled();
		});

		it('a phase error does not abort the remaining phases', async () => {
			(mockModules.enrichment as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('boom'),
			);
			const file = fileIn('Inbox', 'note.md');

			await runner.fireOnFile(file);

			expect(mockModules.rem).toHaveBeenCalledTimes(1);
			expect(mockModules.tidy).toHaveBeenCalledTimes(1);
			expect(mockModules.organize).toHaveBeenCalledTimes(1);
		});
	});
});
