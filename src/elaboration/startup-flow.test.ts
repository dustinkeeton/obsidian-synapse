import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Control isInFlow so we can prove the registry gates the startup auto-scan.
const isInFlowMock = vi.hoisted(() => vi.fn());
vi.mock('../commands', () => ({
	isInFlow: isInFlowMock,
	CommandRegistrar: class {
		register = vi.fn();
		getAttempted = () => new Set<string>();
		getRegistered = () => new Set<string>();
	},
}));

// Stub the heavy collaborators so onload() reduces to: register commands + timers.
vi.mock('./proposal-store', () => ({
	ProposalStore: class { init = vi.fn().mockResolvedValue(undefined); },
}));
vi.mock('./detector', () => ({ PlaceholderDetector: class {} }));
vi.mock('./proposer', () => ({ ProposalGenerator: class {} }));

import { ElaborationModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS } from '../settings';

describe('ElaborationModule — startup flow gate', () => {
	let settings: typeof DEFAULT_SETTINGS;
	let setTimeoutFn: ReturnType<typeof vi.fn>;
	let setIntervalFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
		settings.elaboration.scanOnStartup = true;
		settings.elaboration.autoScanInterval = 10;

		setTimeoutFn = vi.fn().mockReturnValue(1);
		setIntervalFn = vi.fn().mockReturnValue(2);
		isInFlowMock.mockReset();
		vi.stubGlobal('window', {
			setTimeout: setTimeoutFn,
			setInterval: setIntervalFn,
			clearTimeout: vi.fn(),
			clearInterval: vi.fn(),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function makeModule(): ElaborationModule {
		const plugin = { app: {} } as any;
		return new ElaborationModule(plugin, () => settings, {} as any, {} as any, new CommandRegistrar(plugin as any));
	}

	it('schedules the startup + interval scans when scan-vault is in the startup flow', async () => {
		isInFlowMock.mockReturnValue(true);
		await makeModule().onload();
		expect(setTimeoutFn).toHaveBeenCalledTimes(1);
		expect(setIntervalFn).toHaveBeenCalledTimes(1);
	});

	it('skips both auto-scans when scan-vault is removed from the startup flow', async () => {
		isInFlowMock.mockReturnValue(false);
		await makeModule().onload();
		expect(setTimeoutFn).not.toHaveBeenCalled();
		expect(setIntervalFn).not.toHaveBeenCalled();
		expect(isInFlowMock).toHaveBeenCalledWith('scan-vault', 'startup');
	});
});
