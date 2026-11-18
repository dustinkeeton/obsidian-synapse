import { normalizePath, TFile, TFolder } from 'obsidian';
import { redactSecrets } from '../shared';
import type { FeatureSettingsKey } from '../shared';
import { PROPOSAL_KINDS } from '../views';
import type { ProposalKind } from '../views';
import { buildCapabilities } from './capabilities';
import { buildProposalAdapters } from './proposals';
import { buildStatus, featureCapabilities } from './status';
import type {
	ApiRegenerateTarget, ApiResult, ApiScanFeature, DeepDiveRunResult, ScanFolderResult, SynapseApi, SynapseApiDeps,
} from './types';
import { API_VERSION } from './types';

export { API_VERSION } from './types';
export { VERB_DEFINITIONS } from './capabilities';
export type {
	SynapseApi, SynapseApiDeps, ApiResult, DeepDiveRunResult, ScanFolderResult, ApiScanFeature, ApiScanOptions,
	ApiDeepDiveRunOptions, ApiRegenerateTarget, ApiProposal, ApiAcceptOptions, ApiKeySource, ApiFeatureCapability,
	ApiParamSpec, ApiVerbSpec, ApiCapabilities, ApiAIStatus, ApiCheckpointStatus, ApiStatus,
} from './types';

/** Scan features whose output is proposals, so `scanFolder` can report the new ids. */
const SCAN_PROPOSAL_KIND: Partial<Record<ApiScanFeature, ProposalKind>> = {
	elaboration: 'elaboration',
	enrichment: 'enrichment',
	rem: 'rem',
	illustrate: 'illustrate',
	organize: 'organize',
};

const FEATURE_LABEL: Record<ApiScanFeature | 'deepDive', string> = {
	elaboration: 'Elaboration',
	summarize: 'Summarize',
	enrichment: 'Enrichment',
	rem: 'REM',
	illustrate: 'Illustrate',
	tidy: 'Tidy',
	organize: 'Organize',
	deepDive: 'Deep dive',
};

function failure(error: string): ApiResult {
	return { ok: false, error: redactSecrets(error), written: [], proposals: [], cacheUse: null };
}

function scanFailure(error: string): ScanFolderResult {
	return { ...failure(error), count: null };
}

const asIs = (failed: ApiResult): ApiResult => failed;

/** Run a verb body; any throw becomes `{ ok: false, error }` so callers never see a rejection. */
async function settle<T extends ApiResult>(fn: () => Promise<T>, onError: (failed: ApiResult) => T): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		return onError(failure(error instanceof Error ? error.message : String(error)));
	}
}

function isProposalKind(kind: unknown): kind is ProposalKind {
	return typeof kind === 'string' && (PROPOSAL_KINDS as readonly string[]).includes(kind);
}

function toRegenerateTarget(target: ApiRegenerateTarget): { proposalId: string } | { notePath: string } {
	if (typeof target !== 'string') return target;
	return target.endsWith('.md') ? { notePath: target } : { proposalId: target };
}

/** Build the versioned public API (#623). Verbs reach modules only through `deps`, take every answer a modal would ask for, and resolve to a structured result. */
export function createSynapseApi(deps: SynapseApiDeps): SynapseApi {
	const { app, modules } = deps;
	const adapters = buildProposalAdapters(app, modules);

	const disabled = (feature: FeatureSettingsKey, label: string): string | null =>
		deps.getSettings()[feature].enabled ? null : `${label} is disabled in Synapse settings`;

	const noteFile = (notePath: string): TFile | null => {
		const file = app.vault.getAbstractFileByPath(normalizePath(notePath));
		return file instanceof TFile && file.extension === 'md' ? file : null;
	};

	const pendingIds = async (kind: ProposalKind | undefined): Promise<Set<string>> =>
		kind ? new Set((await adapters[kind].list()).map((p) => p.id)) : new Set();

	return {
		version: API_VERSION,

		capabilities: () => buildCapabilities(deps.pluginVersion, featureCapabilities(deps.getSettings(), modules)),

		status: () => buildStatus(deps),

		elaborate: (notePath) => settle(async () => {
			const off = disabled('elaboration', FEATURE_LABEL.elaboration);
			if (off) return failure(off);
			const file = noteFile(notePath);
			if (!file) return failure(`Note not found: ${notePath}`);
			const outcome = await modules.elaboration.scanNote(file, true);
			return outcome.ok
				? { ok: true, message: outcome.message, written: outcome.writtenPaths, proposals: outcome.proposalId ? [outcome.proposalId] : [], cacheUse: outcome.cacheUse }
				: failure(outcome.message);
		}, asIs),

		scanFolder: (feature, folder, options = {}) => settle<ScanFolderResult>(async () => {
			const scan = deps.scanFns[feature];
			if (!scan) return scanFailure(`Unknown scan feature: ${String(feature)}`);
			const off = disabled(feature, FEATURE_LABEL[feature]);
			if (off) return scanFailure(off);
			const path = normalizePath(folder || '/');
			const root = path === '/' || path === '';
			if (!root && !(app.vault.getAbstractFileByPath(path) instanceof TFolder)) {
				return scanFailure(`Folder not found: ${folder}`);
			}
			const kind = SCAN_PROPOSAL_KIND[feature];
			const before = await pendingIds(kind);
			const count = await scan({ folder: root ? undefined : path, recursive: options.recursive ?? true }, true);
			const after = await pendingIds(kind);
			return {
				ok: true,
				message: `${FEATURE_LABEL[feature]} scan finished`,
				written: null,
				proposals: [...after].filter((id) => !before.has(id)),
				cacheUse: null,
				count: typeof count === 'number' ? count : null,
			};
		}, (failed) => ({ ...failed, count: null })),

		deepDive: {
			run: (notePath, options = {}) => settle<DeepDiveRunResult>(async () => {
				const off = disabled('deepDive', FEATURE_LABEL.deepDive);
				if (off) return failure(off);
				const outcome = await modules.deepDive.run(notePath, options);
				const result = { written: outcome.writtenPaths, proposals: outcome.proposalIds, cacheUse: outcome.cacheUse, runId: outcome.runId };
				return outcome.ok
					? { ok: true, message: outcome.message, ...result }
					: { ok: false, error: redactSecrets(outcome.message), ...result };
			}, asIs),

			regenerate: (target) => settle<DeepDiveRunResult>(async () => {
				const off = disabled('deepDive', FEATURE_LABEL.deepDive);
				if (off) return failure(off);
				const outcome = await modules.deepDive.regenerate(toRegenerateTarget(target));
				const result = { written: outcome.writtenPaths, proposals: outcome.proposalIds, cacheUse: outcome.cacheUse, runId: outcome.runId };
				return outcome.ok
					? { ok: true, message: outcome.message, ...result }
					: { ok: false, error: redactSecrets(outcome.message), ...result };
			}, asIs),
		},

		proposals: {
			list: async (kind) => {
				if (kind !== undefined && !isProposalKind(kind)) return [];
				const kinds = kind ? [kind] : PROPOSAL_KINDS;
				const lists = await Promise.all(kinds.map((k) => adapters[k].list()));
				return lists.flat();
			},

			accept: (kind, id, options = {}) => settle(async () => {
				if (!isProposalKind(kind)) return failure(`Unknown proposal kind: ${String(kind)}`);
				if (!(await adapters[kind].list()).some((p) => p.id === id)) return failure(`No pending ${kind} proposal with id ${id}`);
				const outcome = await adapters[kind].accept(id, options);
				return outcome.applied
					? { ok: true, message: 'Proposal accepted', written: outcome.written, proposals: [id], cacheUse: null }
					: { ...failure(outcome.error ?? 'Proposal was not applied'), proposals: [id] };
			}, asIs),

			reject: (kind, id) => settle(async () => {
				if (!isProposalKind(kind)) return failure(`Unknown proposal kind: ${String(kind)}`);
				if (!(await adapters[kind].list()).some((p) => p.id === id)) return failure(`No pending ${kind} proposal with id ${id}`);
				await adapters[kind].reject(id);
				return { ok: true, message: 'Proposal rejected', written: [], proposals: [id], cacheUse: null };
			}, asIs),
		},
	};
}
