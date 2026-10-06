/** Normalized license names the filter settings speak in. */
/** Images taken from the page an action processed carry no repository license; the page itself is the attribution target. */
export const SOURCE_PAGE_LICENSE = 'Source page';

export const LICENSE_NAMES = [
	'CC0',
	'Public domain',
	'CC BY',
	'CC BY-SA',
	'CC BY-ND',
	'CC BY-NC',
	'CC BY-NC-SA',
	'CC BY-NC-ND',
	SOURCE_PAGE_LICENSE,
] as const;

export type LicenseName = (typeof LICENSE_NAMES)[number];

export const DEFAULT_LICENSE_FILTER: LicenseName[] = ['CC0', 'Public domain', 'CC BY', 'CC BY-SA'];

/** Map a provider's license string (Commons short name or Openverse code) to a normalized name; `null` when unrecognized. */
export function normalizeLicense(raw: string): LicenseName | null {
	const value = raw.trim().toLowerCase();
	if (value === '') return null;
	if (value === SOURCE_PAGE_LICENSE.toLowerCase()) return SOURCE_PAGE_LICENSE;
	if (value === 'cc0' || value.startsWith('cc0 ') || value.startsWith('cc0-')) return 'CC0';
	if (value === 'pdm' || value.includes('public domain') || value === 'pd') return 'Public domain';

	const cc = value.match(/^(?:cc[ -]?)?(by(?:[ -]sa|[ -]nd|[ -]nc(?:[ -]sa|[ -]nd)?)?)\b/);
	if (!cc) return null;
	const parts = cc[1].replace(/ /g, '-').toUpperCase();
	switch (parts) {
		case 'BY': return 'CC BY';
		case 'BY-SA': return 'CC BY-SA';
		case 'BY-ND': return 'CC BY-ND';
		case 'BY-NC': return 'CC BY-NC';
		case 'BY-NC-SA': return 'CC BY-NC-SA';
		case 'BY-NC-ND': return 'CC BY-NC-ND';
		default: return null;
	}
}

export function isLicenseAllowed(license: string, allowed: readonly string[]): boolean {
	const normalized = normalizeLicense(license);
	if (!normalized) return false;
	return allowed.some((entry) => normalizeLicense(entry) === normalized);
}
