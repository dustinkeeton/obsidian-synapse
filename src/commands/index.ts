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

export { CommandRegistrar } from './registrar';
export { auditCommands } from './audit';
