import type { TFile } from 'obsidian';

/**
 * Scan function contract that each pipeline module must satisfy.
 * folderPath scopes the scan; skipConfirmation bypasses the
 * user-confirmation dialog (always true when called from Fire Synapse).
 *
 * onlyFile narrows an otherwise folder-scoped scan to a single note: when
 * provided, the module restricts processing to that exact file (filtered
 * right after getMarkdownFiles) while reusing all of its existing scan
 * machinery (checkpoints, progress, exclusions). This backs
 * SynapseRunner.fireOnFile so the intake monitor can target the specific
 * added note without rescanning the whole intake folder per event. When
 * omitted, behaviour is identical to the original folder-scoped scan.
 */
export type PipelineScanFn = (
	folderPath?: string,
	skipConfirmation?: boolean,
	onlyFile?: TFile,
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
