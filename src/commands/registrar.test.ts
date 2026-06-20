import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the registry so we can exercise every status/flow combination
// (the real registry ships everything active + palette).
vi.mock('./registry', () => {
	const entries = [
		{ id: 'cmd:active-palette', name: 'Active', feature: 'main', status: 'active', flows: ['palette'] },
		{ id: 'cmd:icon-override', name: 'Override', feature: 'elaboration', status: 'active', flows: ['palette'], icon: 'synapse-custom' },
		{ id: 'cmd:deprecated', name: 'Deprecated', feature: 'main', status: 'deprecated', flows: ['palette'] },
		{ id: 'cmd:disabled', name: 'Disabled', feature: 'main', status: 'disabled', flows: ['palette'] },
		{ id: 'cmd:no-palette', name: 'Pipeline only', feature: 'main', status: 'active', flows: ['fire-synapse'] },
	];
	return { REGISTRY_BY_ID: new Map(entries.map(e => [e.id, e])) };
});

import { CommandRegistrar } from './registrar';

describe('CommandRegistrar', () => {
	let host: { addCommand: ReturnType<typeof vi.fn> };
	let registrar: CommandRegistrar;
	const spec = { name: 'X', callback: () => {} };

	beforeEach(() => {
		host = { addCommand: vi.fn() };
		registrar = new CommandRegistrar(host as any);
	});

	it('registers an active palette command with its feature-default icon when enabled', () => {
		registrar.register('cmd:active-palette', true, spec);
		expect(host.addCommand).toHaveBeenCalledTimes(1);
		// feature 'main' has no per-entry icon -> resolves to FEATURE_ICONS.main.
		expect(host.addCommand).toHaveBeenCalledWith({ id: 'cmd:active-palette', icon: 'synapse-main', ...spec });
		expect(registrar.getRegistered().has('cmd:active-palette')).toBe(true);
	});

	it('passes through a per-entry icon override', () => {
		registrar.register('cmd:icon-override', true, spec);
		expect(host.addCommand).toHaveBeenCalledWith({ id: 'cmd:icon-override', icon: 'synapse-custom', ...spec });
	});

	it('lets a caller-supplied spec.icon win over the registry-resolved icon', () => {
		registrar.register('cmd:active-palette', true, { ...spec, icon: 'caller-icon' });
		expect(host.addCommand).toHaveBeenCalledWith({ id: 'cmd:active-palette', icon: 'caller-icon', name: 'X', callback: spec.callback });
	});

	it('skips registration when userEnabled is false (still records the attempt)', () => {
		registrar.register('cmd:active-palette', false, spec);
		expect(host.addCommand).not.toHaveBeenCalled();
		expect(registrar.getAttempted().has('cmd:active-palette')).toBe(true);
		expect(registrar.getRegistered().has('cmd:active-palette')).toBe(false);
	});

	it('skips a deprecated command even when enabled', () => {
		registrar.register('cmd:deprecated', true, spec);
		expect(host.addCommand).not.toHaveBeenCalled();
		expect(registrar.getAttempted().has('cmd:deprecated')).toBe(true);
	});

	it('skips a disabled command even when enabled', () => {
		registrar.register('cmd:disabled', true, spec);
		expect(host.addCommand).not.toHaveBeenCalled();
	});

	it('skips a command that is not in the palette flow', () => {
		registrar.register('cmd:no-palette', true, spec);
		expect(host.addCommand).not.toHaveBeenCalled();
		expect(registrar.getAttempted().has('cmd:no-palette')).toBe(true);
	});

	it('fails open for an unknown id (registers + tracks it) so the command keeps working', () => {
		registrar.register('cmd:unknown', true, spec);
		expect(host.addCommand).toHaveBeenCalledWith({ id: 'cmd:unknown', ...spec });
		expect(registrar.getAttempted().has('cmd:unknown')).toBe(true);
		expect(registrar.getRegistered().has('cmd:unknown')).toBe(true);
	});

	it('does not register an unknown id when userEnabled is false', () => {
		registrar.register('cmd:unknown', false, spec);
		expect(host.addCommand).not.toHaveBeenCalled();
	});
});
