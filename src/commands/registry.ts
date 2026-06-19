/**
 * COMMAND_REGISTRY — the single declarative source of truth for every Synapse
 * command, plus the helpers that gate flows against it.
 *
 * Most entries ship `status: 'active'`; a few ship `'disabled'` as a developer-level
 * master switch (the registry sits above user settings). To deprecate/disable a
 * command or remove it from a flow, edit the entry here — no module hunting required.
 *
 * Precedence (all ANDed, registry authoritative):
 *   status (dev) -> flow membership (dev) -> settings.[feature].enabled (user) -> hasTranscription (runtime)
 */

import { CommandDefinition, CommandFlow } from './types';

export const COMMAND_REGISTRY: readonly CommandDefinition[] = [
	// --- main (src/main.ts) ---
	{ id: 'review-proposals', name: 'Open proposal review sidebar', feature: 'main', status: 'active', flows: ['palette'], context: 'global' },
	{ id: 'manage-checkpoints', name: 'Manage interrupted operations', feature: 'main', status: 'active', flows: ['palette'], context: 'global' },
	{ id: 'transcribe-media', name: 'Transcribe media', feature: 'main', status: 'disabled', flows: ['palette'], context: 'global' },
	{ id: 'transcribe-note-media', name: 'Transcribe media from current note', feature: 'main', status: 'active', flows: ['palette'], context: 'note' },
	{ id: 'fire', name: 'Run all features on a directory', feature: 'main', status: 'active', flows: ['palette'], context: 'vault' },

	// --- elaboration (src/elaboration/index.ts) ---
	{ id: 'scan-vault', name: 'Scan vault for stub notes', feature: 'elaboration', status: 'active', flows: ['palette', 'fire-synapse', 'startup'], context: 'vault', pipelineKey: 'elaboration' },
	{ id: 'scan-current-note', name: 'Scan current note for elaboration', feature: 'elaboration', status: 'active', flows: ['palette'], context: 'note' },
	{ id: 'clear-proposals', name: 'Clear all pending proposals', feature: 'elaboration', status: 'disabled', flows: ['palette'], context: 'global' },

	// --- enrichment (src/enrichment/index.ts) ---
	{ id: 'enrich-current-note', name: 'Enrich current note', feature: 'enrichment', status: 'active', flows: ['palette'], context: 'note' },
	{ id: 'scan-vault-enrichment', name: 'Scan vault for enrichment', feature: 'enrichment', status: 'active', flows: ['palette', 'fire-synapse'], context: 'vault', pipelineKey: 'enrichment' },
	{ id: 'undo-enrichment', name: 'Undo last enrichment on current note', feature: 'enrichment', status: 'disabled', flows: ['palette'], context: 'note' },

	// --- organize (src/organize/index.ts) ---
	{ id: 'organize-current-note', name: 'Organize current note', feature: 'organize', status: 'active', flows: ['palette'], context: 'note' },
	{ id: 'scan-directory-organize', name: 'Scan directory for organization', feature: 'organize', status: 'active', flows: ['palette', 'fire-synapse'], context: 'vault', pipelineKey: 'organize' },
	{ id: 'undo-organize', name: 'Undo last organize on current note', feature: 'organize', status: 'disabled', flows: ['palette'], context: 'note' },

	// --- deep-dive (src/deep-dive/index.ts) ---
	{ id: 'deep-dive', name: 'Deep dive into current note', feature: 'deep-dive', status: 'active', flows: ['palette'], context: 'note' },
	{ id: 'clear-deep-dive', name: 'Clear deep dive proposals', feature: 'deep-dive', status: 'disabled', flows: ['palette'], context: 'global' },

	// --- summarize (src/summarize/index.ts) ---
	{ id: 'summarize-current-note', name: 'Summarize current note', feature: 'summarize', status: 'active', flows: ['palette'], context: 'note' },
	{ id: 'scan-vault-summarize', name: 'Scan vault for notes to summarize', feature: 'summarize', status: 'active', flows: ['palette', 'fire-synapse'], context: 'vault', pipelineKey: 'summarize' },

	// --- tidy (src/tidy/index.ts) ---
	{ id: 'tidy-current-note', name: 'Tidy current note', feature: 'tidy', status: 'active', flows: ['palette'], context: 'note' },
	{ id: 'undo-tidy', name: 'Undo last tidy on current note', feature: 'tidy', status: 'disabled', flows: ['palette'], context: 'note' },

	// --- rem (src/rem/index.ts) ---
	{ id: 'rem-current-note', name: 'REM: Discover links in current note', feature: 'rem', status: 'active', flows: ['palette'], context: 'note' },
	{ id: 'rem-directory', name: 'REM: Discover links in directory', feature: 'rem', status: 'active', flows: ['palette', 'fire-synapse'], context: 'vault', pipelineKey: 'rem' },

	// --- video (src/video/index.ts) ---
	{ id: 'check-dependencies', name: 'Check external tool availability', feature: 'video', status: 'active', flows: ['palette'], context: 'global' },

	// --- synthetic, pipeline-only ---
	// Tidy is the only Fire Synapse phase with no matching palette command: the
	// pipeline runs `tidy.scanVault()` (vault-wide), whereas the `tidy-current-note`
	// palette command runs `tidy()` on a single note — a different operation. This
	// entry carries `pipelineKey: 'tidy'` so the tidy pipeline phase is controlled
	// independently of the palette command. It is never passed to registrar.register().
	{ id: 'tidy-vault', name: 'Tidy vault', feature: 'tidy', status: 'active', flows: ['fire-synapse'], context: 'vault', pipelineKey: 'tidy', note: 'vault scan run only by Fire Synapse; no palette command' },
];

/** Lookup by command id. */
export const REGISTRY_BY_ID: ReadonlyMap<string, CommandDefinition> = new Map(
	COMMAND_REGISTRY.map(c => [c.id, c]),
);

/**
 * Build a 1:1 `pipelineKey -> entry` map. Throws on a duplicate `pipelineKey` so
 * a future copy-paste can't silently shadow an earlier mapping. Exported for tests.
 */
export function buildPipelineKeyMap(
	commands: readonly CommandDefinition[],
): Map<string, CommandDefinition> {
	const map = new Map<string, CommandDefinition>();
	for (const cmd of commands) {
		if (!cmd.pipelineKey) continue;
		if (map.has(cmd.pipelineKey)) {
			throw new Error(`[Synapse] Duplicate pipelineKey in COMMAND_REGISTRY: ${cmd.pipelineKey}`);
		}
		map.set(cmd.pipelineKey, cmd);
	}
	return map;
}

/** Lookup by pipeline phase key (1:1). */
export const REGISTRY_BY_PIPELINE_KEY: ReadonlyMap<string, CommandDefinition> =
	buildPipelineKeyMap(COMMAND_REGISTRY);

/** True when the command exists, is `active`, and participates in `flow`. */
export function isInFlow(id: string, flow: CommandFlow): boolean {
	const entry = REGISTRY_BY_ID.get(id);
	return !!entry && entry.status === 'active' && entry.flows.includes(flow);
}

/**
 * True when the command mapped to `pipelineKey` participates in `flow`.
 * Fail-OPEN: an unmapped key returns `true` so any future pipeline phase without
 * a registry mapping keeps running exactly as it does today (behavior preserving).
 */
export function isPipelineKeyInFlow(pipelineKey: string, flow: CommandFlow): boolean {
	const entry = REGISTRY_BY_PIPELINE_KEY.get(pipelineKey);
	return entry ? isInFlow(entry.id, flow) : true;
}
