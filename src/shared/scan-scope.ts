/** Which notes a folder scan processes; `folder` undefined = vault root. */
export interface ScanScope {
	folder?: string;
	recursive: boolean;
	/** Public-API job running this scan (#624); its operations are tagged with `jobOpId`. */
	jobId?: string;
}

/** Scan-entry argument: a bare folder path (recursive) or an explicit scope. */
export type ScanTarget = string | ScanScope;

export function toScanScope(target?: ScanTarget): ScanScope {
	if (target === undefined) return { recursive: true };
	if (typeof target === 'string') return { folder: target || undefined, recursive: true };
	return { folder: target.folder || undefined, recursive: target.recursive, ...(target.jobId ? { jobId: target.jobId } : {}) };
}

/** Folder label for scan copy; undefined for a recursive whole-vault scan so callers keep their "vault" wording. */
export function scanScopeLabel(target?: ScanTarget): string | undefined {
	const scope = toScanScope(target);
	if (scope.recursive) return scope.folder;
	return `${scope.folder ?? 'vault root'} (top level)`;
}
