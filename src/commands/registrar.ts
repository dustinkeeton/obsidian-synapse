/**
 * CommandRegistrar — the single wiring point between feature modules and
 * Obsidian's `addCommand`. Modules keep their handlers co-located but call
 * `registrar.register(id, userEnabled, spec)` instead of `plugin.addCommand(...)`.
 *
 * A command is actually registered only when the registry says it's `active` and
 * in the `'palette'` flow AND the user has the owning feature enabled. The
 * palette label is resolved from COMMAND_REGISTRY (single source of truth shared
 * with the action panel; #357) — callers no longer pass a `name`. The registrar
 * also tracks every attempted/registered id for drift detection (audit.ts).
 */

import type { Command } from 'obsidian';
import { REGISTRY_BY_ID } from './registry';
import { resolveActionIcon } from './icons';

/** Minimal structural shape we need from the plugin — keeps tests trivial. */
interface AddCommandHost {
	addCommand: (command: Command) => unknown;
}

export class CommandRegistrar {
	private readonly attempted = new Set<string>();
	private readonly registered = new Set<string>();

	constructor(private readonly host: AddCommandHost) {}

	/**
	 * Register a palette command through the registry gate.
	 *
	 * @param id          command id (must match a COMMAND_REGISTRY entry)
	 * @param userEnabled user-level enablement (the feature's `enabled` flag, or a
	 *                    runtime predicate such as `hasTranscription`)
	 * @param spec        the rest of the Obsidian command (a callback, optional icon,
	 *                    etc.) — NOT the label. The palette `name` is sourced from
	 *                    COMMAND_REGISTRY (#357), not from the spec.
	 */
	register(id: string, userEnabled: boolean, spec: Omit<Command, 'id' | 'name'>): void {
		this.attempted.add(id);

		const entry = REGISTRY_BY_ID.get(id);
		// Fail-open on an unknown id: still register it so the command keeps working,
		// and let auditCommands() surface the missing registry entry as drift.
		const active = entry ? entry.status === 'active' : true;
		const inPalette = entry ? entry.flows.includes('palette') : true;

		if (active && inPalette && userEnabled) {
			// Give the palette command its registry-resolved icon (feature glyph or
			// per-action override; #349). Spread `spec` last so a caller-supplied
			// icon still wins.
			const icon = entry ? resolveActionIcon(entry) : undefined;
			// Name comes from COMMAND_REGISTRY (single source of truth, shared with the
			// action panel; #357). Fail-open to the id; auditCommands() flags the miss.
			const name = entry ? entry.name : id;
			this.host.addCommand({ id, name, ...(icon ? { icon } : {}), ...spec });
			this.registered.add(id);
		}
	}

	/** Ids passed to register(), regardless of whether they were gated out. */
	getAttempted(): ReadonlySet<string> {
		return this.attempted;
	}

	/** Ids that passed the gate and actually called addCommand. */
	getRegistered(): ReadonlySet<string> {
		return this.registered;
	}
}
