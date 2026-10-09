import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FUNDING_LINKS } from './funding';

const readRepoFile = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');

describe('FUNDING_LINKS', () => {
	it('matches manifest.json fundingUrl exactly', () => {
		const manifest = JSON.parse(readRepoFile('manifest.json')) as {
			fundingUrl: Record<string, string>;
		};
		const fromConstant = Object.fromEntries(FUNDING_LINKS.map((l) => [l.label, l.url]));
		expect(fromConstant).toEqual(manifest.fundingUrl);
	});

	it('matches the destinations listed in .github/FUNDING.yml', () => {
		const yml = readRepoFile('.github/FUNDING.yml');
		const githubUser = /^github:\s*\[\s*([\w-]+)\s*\]/m.exec(yml)?.[1];
		const customUrls = [...yml.matchAll(/"(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
		const urls = FUNDING_LINKS.map((l) => l.url);

		expect(urls).toContain(`https://github.com/sponsors/${githubUser}`);
		for (const url of customUrls) expect(urls).toContain(url);
		expect(urls).toHaveLength(1 + customUrls.length);
	});
});
