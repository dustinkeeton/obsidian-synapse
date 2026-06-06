/**
 * Drift detection between COMMAND_REGISTRY and the actually-wired handlers.
 * Run once at the end of plugin onload() and reused by a Vitest test so CI fails
 * on drift in either direction.
 */

import { COMMAND_REGISTRY, REGISTRY_BY_ID } from './registry';

/**
 * Returns a list of human-readable drift warnings (empty when consistent).
 *
 * (a) An `active` palette entry whose feature loaded but was never registered —
 *     i.e. a registry entry with no handler behind it.
 * (b) A registered id that has no COMMAND_REGISTRY entry — a command added in code
 *     but missing from the registry.
 *
 * "Feature loaded" is derived from `attempted`: a module's onload() is the only
 * caller of register() for its commands, and onload() runs iff the feature is
 * enabled. So a feature is considered loaded when >=1 of its commands was
 * attempted. This makes the check correct for the platform-gated video module for
 * free, and needs nothing passed in from main.ts.
 *
 * Known, intentional limitation: a fully disabled feature (onload never runs)
 * produces zero attempts and so cannot be drift-checked — its handlers never got
 * a chance to register.
 */
export function auditCommands(attempted: ReadonlySet<string>): string[] {
	const warnings: string[] = [];

	const featuresWithAttempts = new Set(
		[...attempted].map(id => REGISTRY_BY_ID.get(id)?.feature).filter(Boolean),
	);

	// (a) active palette entry for a loaded feature that was never registered
	for (const entry of COMMAND_REGISTRY) {
		if (
			entry.status === 'active' &&
			entry.flows.includes('palette') &&
			featuresWithAttempts.has(entry.feature) &&
			!attempted.has(entry.id)
		) {
			warnings.push(`Active command "${entry.id}" (${entry.feature}) has no handler`);
		}
	}

	// (b) registered id missing from the registry
	for (const id of attempted) {
		if (!REGISTRY_BY_ID.has(id)) {
			warnings.push(`Command "${id}" is registered but missing from COMMAND_REGISTRY`);
		}
	}

	return warnings;
}
