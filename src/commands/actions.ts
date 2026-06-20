/**
 * Registry-driven derivation of the palette actions a user can actually invoke.
 *
 * The Synapse actions sidebar (`src/views/synapse-actions-view.ts`) renders one
 * button per entry returned here. We don't re-declare any command behavior — the
 * button invokes the already-registered Obsidian command by id. This keeps the
 * sidebar in lockstep with the command registry (no hand-maintained list).
 */

import { COMMAND_REGISTRY } from './registry';
import type { CommandDefinition } from './types';

/**
 * The active palette commands the user actually has enabled, in registry order.
 *
 * `registered` is `CommandRegistrar.getRegistered()` — the ids that passed the
 * full gate (`status === 'active'` AND `flows.includes('palette')` AND the
 * feature's user-level `enabled` flag). Filtering by membership therefore
 * naturally excludes disabled-status commands, the pipeline-only `tidy-vault`
 * (never registered), and any feature the user has turned off.
 */
export function listPaletteActions(registered: ReadonlySet<string>): CommandDefinition[] {
	return COMMAND_REGISTRY.filter((c) => registered.has(c.id));
}
