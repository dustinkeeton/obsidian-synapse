import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force isPipelineKeyInFlow to a controllable mock so we can prove the registry
// gates the Fire Synapse pipeline. (The main synapse-runner.test.ts uses the real
// module, where every phase is active and runs — proving behavior preservation.)
const isPipelineKeyInFlowMock = vi.hoisted(() => vi.fn());
vi.mock('../commands', () => ({ isPipelineKeyInFlow: isPipelineKeyInFlowMock }));

import { SynapseRunner } from './synapse-runner';
import { DEFAULT_SETTINGS } from '../settings';
import type { PipelineModuleMap } from './types';

function createMockNotifications() {
	const handle = { update: vi.fn(), progress: vi.fn(), finish: vi.fn(), error: vi.fn(), cancelled: false };
	return {
		startOperation: vi.fn().mockReturnValue(handle),
		info: vi.fn(), success: vi.fn(), notifyError: vi.fn(),
		_handle: handle,
	};
}

function createMockModules(): PipelineModuleMap {
	return {
		elaboration: vi.fn().mockResolvedValue(0),
		summarize: vi.fn().mockResolvedValue(undefined),
		enrichment: vi.fn().mockResolvedValue(0),
		rem: vi.fn().mockResolvedValue(0),
		tidy: vi.fn().mockResolvedValue(0),
		organize: vi.fn().mockResolvedValue(0),
	};
}

describe('SynapseRunner — registry fire-synapse gate', () => {
	let runner: SynapseRunner;
	let mockModules: PipelineModuleMap;
	let settings: typeof DEFAULT_SETTINGS;

	beforeEach(() => {
		isPipelineKeyInFlowMock.mockReset();
		settings = structuredClone(DEFAULT_SETTINGS);
		for (const key of ['elaboration', 'summarize', 'enrichment', 'rem', 'tidy', 'organize'] as const) {
			(settings[key] as { enabled: boolean }).enabled = true;
		}
		mockModules = createMockModules();
		runner = new SynapseRunner(mockModules, () => settings, createMockNotifications() as any);
	});

	it('runs every enabled phase when all are in the fire-synapse flow', async () => {
		isPipelineKeyInFlowMock.mockReturnValue(true);
		await runner.fire();
		for (const key of Object.keys(mockModules) as (keyof PipelineModuleMap)[]) {
			expect(mockModules[key]).toHaveBeenCalled();
		}
	});

	it('skips a phase whose command was removed from the fire-synapse flow', async () => {
		// tidy removed from the flow even though settings.tidy.enabled is true
		isPipelineKeyInFlowMock.mockImplementation((key: string) => key !== 'tidy');
		await runner.fire();

		expect(mockModules.elaboration).toHaveBeenCalled();
		expect(mockModules.organize).toHaveBeenCalled();
		expect(mockModules.tidy).not.toHaveBeenCalled();
		expect(isPipelineKeyInFlowMock).toHaveBeenCalledWith('tidy', 'fire-synapse');
	});
});
