// Injected per build by the `synapse-build-info` esbuild plugin; vitest defines the production shape.
declare const __SYNAPSE_BUILD__: string;

/** Build identity stamped into `main.js`; dev fields are absent on a release build. */
export interface BuildInfo {
	dev: boolean;
	sha?: string;
	branch?: string;
	dirty?: boolean;
	builtAt?: string;
}

export const PRODUCTION_BUILD: Readonly<BuildInfo> = Object.freeze({ dev: false });

/** Parse the raw build constant; anything malformed is treated as a production build. */
export function parseBuildInfo(raw: unknown): BuildInfo {
	if (typeof raw !== 'string') return { ...PRODUCTION_BUILD };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...PRODUCTION_BUILD };
	}
	if (typeof parsed !== 'object' || parsed === null) return { ...PRODUCTION_BUILD };
	const rec = parsed as Record<string, unknown>;
	if (rec.dev !== true) return { ...PRODUCTION_BUILD };
	const info: BuildInfo = { dev: true };
	if (typeof rec.sha === 'string' && rec.sha) info.sha = rec.sha;
	if (typeof rec.branch === 'string' && rec.branch) info.branch = rec.branch;
	if (typeof rec.dirty === 'boolean') info.dirty = rec.dirty;
	if (typeof rec.builtAt === 'string' && rec.builtAt) info.builtAt = rec.builtAt;
	return info;
}

export const BUILD_INFO: Readonly<BuildInfo> = parseBuildInfo(
	typeof __SYNAPSE_BUILD__ === 'undefined' ? undefined : __SYNAPSE_BUILD__,
);

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** Local `YYYY-MM-DD HH:mm` for an ISO timestamp; the raw value if it does not parse. */
export function formatBuiltAt(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The ` · `-joined detail after the "Development build" lead; empty for a production build. */
export function describeDevBuild(info: BuildInfo, version: string): string {
	if (!info.dev) return '';
	const parts: string[] = [];
	if (info.branch || info.sha) {
		const ref = [info.branch, info.sha].filter(Boolean).join(' @ ');
		parts.push(info.dirty ? `${ref} (dirty)` : ref);
	} else if (info.dirty) {
		parts.push('dirty');
	}
	if (info.builtAt) parts.push(`built ${formatBuiltAt(info.builtAt)}`);
	parts.push(`based on v${version}`);
	return parts.join(' · ');
}
