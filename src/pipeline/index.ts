export { SynapseRunner } from './synapse-runner';
export { SYNAPSE_PIPELINE } from './types';
export { buildPostOpHook, buildAutoOrganizeHook } from './post-op-hooks';
export type { PostOpHookDeps } from './post-op-hooks';
export type {
	PipelineModuleKey,
	PipelineModuleMap,
	PipelinePhase,
	PipelineScanFn,
	PostOpSource,
	PostOpTrigger,
	PostOpHook,
	AutoOrganizeTrigger,
} from './types';
