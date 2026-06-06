import { describe, it, expect, vi } from 'vitest';

// Controlled registry: two elaboration palette commands, one video palette
// command, one tidy palette command, and a synthetic pipeline-only tidy entry.
vi.mock('./registry', () => {
	const COMMAND_REGISTRY = [
		{ id: 'el:1', name: 'El 1', feature: 'elaboration', status: 'active', flows: ['palette'] },
		{ id: 'el:2', name: 'El 2', feature: 'elaboration', status: 'active', flows: ['palette'] },
		{ id: 'vid:1', name: 'Vid 1', feature: 'video', status: 'active', flows: ['palette'] },
		{ id: 'tidy:1', name: 'Tidy 1', feature: 'tidy', status: 'active', flows: ['palette'] },
		{ id: 'tidy:vault', name: 'Tidy vault', feature: 'tidy', status: 'active', flows: ['fire-synapse'] },
	];
	return {
		COMMAND_REGISTRY,
		REGISTRY_BY_ID: new Map(COMMAND_REGISTRY.map(c => [c.id, c])),
	};
});

import { auditCommands } from './audit';

describe('auditCommands', () => {
	it('warns when a loaded feature has an active palette command with no handler', () => {
		const warnings = auditCommands(new Set(['el:1']));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('el:2');
		expect(warnings[0]).toContain('no handler');
	});

	it('warns when a registered id is missing from the registry', () => {
		const warnings = auditCommands(new Set(['el:1', 'el:2', 'ghost:cmd']));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('ghost:cmd');
		expect(warnings[0]).toContain('missing from COMMAND_REGISTRY');
	});

	it('returns no warnings when the loaded feature is fully wired', () => {
		expect(auditCommands(new Set(['el:1', 'el:2']))).toEqual([]);
	});

	it('never flags the synthetic pipeline-only entry (no palette flow)', () => {
		const warnings = auditCommands(new Set(['tidy:1']));
		expect(warnings).toEqual([]);
		expect(warnings.some(w => w.includes('tidy:vault'))).toBe(false);
	});

	it('ignores features that never loaded (zero attempts)', () => {
		const warnings = auditCommands(new Set(['el:1', 'el:2']));
		expect(warnings.some(w => w.includes('vid:1'))).toBe(false);
	});
});
