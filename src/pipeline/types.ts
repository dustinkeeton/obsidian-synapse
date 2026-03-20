/**
 * Scan function contract that each pipeline module must satisfy.
 * folderPath scopes the scan; skipConfirmation bypasses the
 * user-confirmation dialog (always true when called from Fire Synapse).
 */
export type PipelineScanFn = (
	folderPath?: string,
	skipConfirmation?: boolean,
) => Promise<number | void>;

export type PipelineModuleKey =
	| 'elaboration'
	| 'summarize'
	| 'enrichment'
	| 'rem'
	| 'tidy'
	| 'organize';

export interface PipelinePhase {
	key: PipelineModuleKey;
	label: string;
}

export type PipelineModuleMap = Record<PipelineModuleKey, PipelineScanFn>;

/**
 * Ordered pipeline phases for Fire Synapse.
 * Elaboration → Summarize → Enrichment → REM → Tidy → Organize
 */
export const SYNAPSE_PIPELINE: PipelinePhase[] = [
	{ key: 'elaboration', label: 'Elaboration' },
	{ key: 'summarize', label: 'Summarize' },
	{ key: 'enrichment', label: 'Enrichment' },
	{ key: 'rem', label: 'REM' },
	{ key: 'tidy', label: 'Tidy' },
	{ key: 'organize', label: 'Organize' },
];
