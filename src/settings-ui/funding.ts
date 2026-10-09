export interface FundingLink {
	readonly id: 'github-sponsors' | 'buy-me-a-coffee';
	readonly label: string;
	readonly url: string;
	readonly subtitle: string;
	/** Lucide icon id passed to Obsidian's setIcon. */
	readonly icon: string;
}

/** Funding destinations; must match `manifest.json` fundingUrl and `.github/FUNDING.yml` (enforced by funding.test.ts). */
export const FUNDING_LINKS: readonly FundingLink[] = [
	{
		id: 'github-sponsors',
		label: 'GitHub Sponsors',
		url: 'https://github.com/sponsors/dustinkeeton',
		subtitle: 'Monthly or one-time',
		icon: 'heart',
	},
	{
		id: 'buy-me-a-coffee',
		label: 'Buy Me a Coffee',
		url: 'https://www.buymeacoffee.com/dustinkeeton',
		subtitle: 'One-time tip, no account needed',
		icon: 'coffee',
	},
];
