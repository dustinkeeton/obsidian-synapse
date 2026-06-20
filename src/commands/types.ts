/**
 * Command registry types — the developer-facing source of truth for every
 * user-invocable command in Synapse.
 *
 * The registry sits ABOVE user settings as an authoritative master-control /
 * deprecation layer. See `registry.ts` for the entries and `registrar.ts` for
 * how handlers are wired through it.
 */

/** Developer-level master switch for a command. `active` is the only state that registers/runs. */
export type CommandStatus = 'active' | 'deprecated' | 'disabled';

/** The flows a command can participate in. */
export type CommandFlow = 'palette' | 'fire-synapse' | 'startup';

/**
 * The runtime environment a command needs to act on.
 * - `note`   — operates on the active note (Obsidian `editorCallback`); unavailable when no markdown note is active.
 * - `vault`  — operates over the vault or a chosen folder (vault scan / folder picker); always available.
 * - `global` — app-level action independent of any note (open a view, manage checkpoints); always available.
 *
 * Consumed by the Synapse actions sidebar (`src/views/synapse-actions-view.ts`) to disable
 * `note` buttons when no note is active. Mirrors each command's handler kind in its module.
 */
export type CommandContext = 'note' | 'vault' | 'global';

/** The feature module a command belongs to (modules without commands are omitted). */
export type FeatureKey =
	| 'main'
	| 'elaboration'
	| 'enrichment'
	| 'organize'
	| 'deep-dive'
	| 'summarize'
	| 'tidy'
	| 'rem'
	| 'video';

/** A single declarative command entry. */
export interface CommandDefinition {
	/**
	 * Command id WITHOUT the plugin-id prefix, e.g. `scan-vault`. Obsidian prepends
	 * the manifest id automatically, so the user-facing id becomes `synapse:scan-vault`.
	 * Including `synapse:` here would double-prefix it (`synapse:synapse:scan-vault`).
	 */
	id: string;
	/** Display name shown in the command palette. */
	name: string;
	/** Owning feature module. */
	feature: FeatureKey;
	/** Master status. Only `active` commands register and run. */
	status: CommandStatus;
	/** Flows this command participates in. All palette commands include `'palette'`. */
	flows: readonly CommandFlow[];
	/** Runtime environment the command needs (drives per-note gating in the actions sidebar). */
	context: CommandContext;
	/**
	 * Registered glyph name (Obsidian `addIcon` id) overriding the command's
	 * feature-default icon. Used for the heterogeneous General/`main` actions,
	 * which bundle dissimilar operations and so don't share one feature glyph.
	 * Resolution lives in `resolveActionIcon` (`./icons`); omit to inherit
	 * `FEATURE_ICONS[feature]`.
	 */
	icon?: string;
	/**
	 * Links a command to a Fire Synapse pipeline phase (matches a `PipelineModuleKey`).
	 * Typed as `string` deliberately so `src/commands/` never imports from `src/pipeline/`
	 * (which imports back from here) — avoids a module cycle. The registry test
	 * cross-checks these values against `SYNAPSE_PIPELINE`.
	 */
	pipelineKey?: string;
	/** Free-form developer note (e.g. why an entry is pipeline-only). */
	note?: string;
}
