/**
 * Public surface of the command registry module.
 *
 * Consumers import from `../commands`:
 *   - main.ts + all feature modules: `CommandRegistrar`
 *   - pipeline/synapse-runner.ts: `isPipelineKeyInFlow`
 *   - elaboration/index.ts: `isInFlow`
 *   - main.ts (end of onload): `auditCommands`
 *
 * This module depends on nothing else in `src/`, so it never participates in an
 * import cycle.
 */

export type {
	CommandStatus,
	CommandFlow,
	CommandContext,
	FeatureKey,
	CommandDefinition,
} from './types';

export {
	COMMAND_REGISTRY,
	REGISTRY_BY_ID,
	REGISTRY_BY_PIPELINE_KEY,
	isInFlow,
	isPipelineKeyInFlow,
} from './registry';

export { listPaletteActions } from './actions';
export { FEATURE_ICONS, resolveActionIcon } from './icons';
export { CommandRegistrar } from './registrar';
export { auditCommands } from './audit';
export { dispatchSidebarCommand } from './dispatch';
export type { CommandDispatchHost, InvokableCommand, NoteEditorContext } from './dispatch';
