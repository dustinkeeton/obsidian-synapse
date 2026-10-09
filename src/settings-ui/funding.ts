/** Funding destinations; must match `manifest.json` fundingUrl and `.github/FUNDING.yml` (enforced by funding.test.ts). */
export const FUNDING_LINKS: ReadonlyArray<{ readonly label: string; readonly url: string }> = [
	{ label: 'GitHub Sponsors', url: 'https://github.com/sponsors/dustinkeeton' },
	{ label: 'Buy Me a Coffee', url: 'https://www.buymeacoffee.com/dustinkeeton' },
];
