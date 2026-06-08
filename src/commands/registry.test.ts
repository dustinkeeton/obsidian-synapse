import { describe, it, expect } from 'vitest';
import {
	COMMAND_REGISTRY,
	REGISTRY_BY_ID,
	REGISTRY_BY_PIPELINE_KEY,
	buildPipelineKeyMap,
	isInFlow,
	isPipelineKeyInFlow,
} from './registry';
import { SYNAPSE_PIPELINE } from '../pipeline';
import type { CommandDefinition } from './types';

/** The 23 real, user-invocable command ids (excludes the synthetic pipeline entry). */
const EXPECTED_COMMAND_IDS = [
	'synapse:review-proposals', 'synapse:manage-checkpoints', 'synapse:transcribe-media',
	'synapse:transcribe-note-media', 'synapse:fire',
	'synapse:scan-vault', 'synapse:scan-current-note', 'synapse:clear-proposals',
	'synapse:enrich-current-note', 'synapse:scan-vault-enrichment', 'synapse:undo-enrichment',
	'synapse:organize-current-note', 'synapse:scan-directory-organize', 'synapse:undo-organize',
	'synapse:deep-dive', 'synapse:clear-deep-dive',
	'synapse:summarize-current-note', 'synapse:scan-vault-summarize',
	'synapse:tidy-current-note', 'synapse:undo-tidy',
	'synapse:rem-current-note', 'synapse:rem-directory',
	'synapse:check-dependencies',
];

describe('COMMAND_REGISTRY', () => {
	it('contains all 23 real commands plus the synthetic tidy-vault entry', () => {
		expect(COMMAND_REGISTRY).toHaveLength(EXPECTED_COMMAND_IDS.length + 1);
		for (const id of EXPECTED_COMMAND_IDS) {
			expect(REGISTRY_BY_ID.has(id)).toBe(true);
		}
		expect(REGISTRY_BY_ID.has('synapse:tidy-vault')).toBe(true);
	});

	it('has no duplicate ids', () => {
		const ids = COMMAND_REGISTRY.map(c => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('gives every entry a valid status', () => {
		const validStatuses = ['active', 'deprecated', 'disabled'];
		for (const entry of COMMAND_REGISTRY) {
			expect(validStatuses).toContain(entry.status);
		}
	});

	it('disables exactly the intentionally-deactivated commands', () => {
		const disabled = COMMAND_REGISTRY.filter(c => c.status === 'disabled')
			.map(c => c.id)
			.sort();
		expect(disabled).toEqual([
			'synapse:clear-deep-dive',
			'synapse:clear-proposals',
			'synapse:transcribe-media',
			'synapse:undo-enrichment',
			'synapse:undo-organize',
			'synapse:undo-tidy',
		]);
	});

	it('gives every real command the palette flow', () => {
		for (const id of EXPECTED_COMMAND_IDS) {
			expect(REGISTRY_BY_ID.get(id)!.flows).toContain('palette');
		}
	});

	it('keeps the synthetic tidy-vault entry out of the palette', () => {
		const tidyVault = REGISTRY_BY_ID.get('synapse:tidy-vault')!;
		expect(tidyVault.flows).not.toContain('palette');
		expect(tidyVault.flows).toContain('fire-synapse');
	});

	it('marks exactly scan-vault as a startup flow command', () => {
		const startupCommands = COMMAND_REGISTRY.filter(c => c.flows.includes('startup'));
		expect(startupCommands.map(c => c.id)).toEqual(['synapse:scan-vault']);
	});

	it('gives every entry a non-empty name', () => {
		for (const entry of COMMAND_REGISTRY) {
			expect(entry.name.length).toBeGreaterThan(0);
		}
	});
});

describe('pipeline mapping', () => {
	it('maps exactly one registry entry per Fire Synapse phase', () => {
		const phaseKeys = SYNAPSE_PIPELINE.map(p => p.key).sort();
		const mappedKeys = [...REGISTRY_BY_PIPELINE_KEY.keys()].sort();
		expect(mappedKeys).toEqual(phaseKeys);
	});

	it('points each phase at an active fire-synapse command', () => {
		for (const phase of SYNAPSE_PIPELINE) {
			const entry = REGISTRY_BY_PIPELINE_KEY.get(phase.key);
			expect(entry, `no registry entry for phase ${phase.key}`).toBeDefined();
			expect(entry!.status).toBe('active');
			expect(entry!.flows).toContain('fire-synapse');
		}
	});

	it('throws when two entries share a pipelineKey', () => {
		const dupes: CommandDefinition[] = [
			{ id: 'a', name: 'A', feature: 'tidy', status: 'active', flows: ['fire-synapse'], pipelineKey: 'tidy' },
			{ id: 'b', name: 'B', feature: 'tidy', status: 'active', flows: ['fire-synapse'], pipelineKey: 'tidy' },
		];
		expect(() => buildPipelineKeyMap(dupes)).toThrow(/Duplicate pipelineKey/);
	});
});

describe('isInFlow', () => {
	it('is true for an active command in the requested flow', () => {
		expect(isInFlow('synapse:scan-vault', 'palette')).toBe(true);
		expect(isInFlow('synapse:scan-vault', 'fire-synapse')).toBe(true);
		expect(isInFlow('synapse:scan-vault', 'startup')).toBe(true);
	});

	it('is false for a flow the command does not participate in', () => {
		expect(isInFlow('synapse:scan-current-note', 'fire-synapse')).toBe(false);
		expect(isInFlow('synapse:scan-current-note', 'startup')).toBe(false);
	});

	it('is false for an unknown id', () => {
		expect(isInFlow('synapse:does-not-exist', 'palette')).toBe(false);
	});
});

describe('isPipelineKeyInFlow', () => {
	it('is true for every shipped pipeline phase (behavior preserving)', () => {
		for (const phase of SYNAPSE_PIPELINE) {
			expect(isPipelineKeyInFlow(phase.key, 'fire-synapse')).toBe(true);
		}
	});

	it('fails open (true) for an unmapped pipeline key', () => {
		expect(isPipelineKeyInFlow('not-a-real-phase', 'fire-synapse')).toBe(true);
	});
});
