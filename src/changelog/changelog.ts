/**
 * Pure changelog parsing + rendering (#375).
 *
 * `CHANGELOG.md` (Keep a Changelog format) is inlined at build time as a string
 * (esbuild `.md` text loader). This module turns that string into a small data
 * model and renders it to DOM with `createEl`, so the logic stays synchronous
 * and unit-testable with the Obsidian mock — no `MarkdownRenderer`, no `.md`
 * import here (that lives in `changelog-modal.ts`, the thin UI wrapper).
 */

/** One `### Added` / `### Changed` / … block within a version entry. */
export interface ChangelogSection {
	/** Section title, e.g. "Added". Empty for items that precede any heading. */
	title: string;
	/** Bullet lines under the section, with inline markdown stripped. */
	items: string[];
}

/** One `## [version] - date` release block. */
export interface ChangelogEntry {
	/** Version label, e.g. "1.0.6" or "Unreleased". */
	version: string;
	/** Release date (e.g. "2026-06-22"), or null when absent (Unreleased). */
	date: string | null;
	/** The release's `###` sections, in document order. */
	sections: ChangelogSection[];
}

/**
 * Strip the inline markdown that shows up in changelog bullets so the rendered
 * text reads cleanly without a full markdown renderer: links → their text,
 * `**bold**` and `` `code` `` → their inner content.
 */
export function stripInlineMarkdown(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
		.replace(/\*\*([^*]+)\*\*/g, '$1') // **bold** → bold
		.replace(/`([^`]+)`/g, '$1'); // `code` → code
}

/** Parse a `## …` heading line into a version label and optional date. */
function parseVersionHeading(raw: string): { version: string; date: string | null } {
	const text = raw.trim();
	// Canonical Keep a Changelog form: `[1.0.6] - 2026-06-22` or `[Unreleased]`.
	const bracketed = text.match(/^\[([^\]]+)\]\s*(?:[-–—]\s*(.+))?$/);
	if (bracketed) {
		return { version: bracketed[1].trim(), date: bracketed[2]?.trim() ?? null };
	}
	// Defensive fallback: `1.0.6 - 2026-06-22` (no brackets).
	const dashed = text.split(/\s+[-–—]\s+/);
	return { version: dashed[0].trim(), date: dashed[1]?.trim() ?? null };
}

/**
 * Parse Keep a Changelog markdown into release entries. Only `## ` version
 * headings, `### ` section headings, and `- `/`* ` bullets are interpreted; the
 * file's `# Changelog` title and preamble (everything before the first `## `)
 * are ignored.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	let entry: ChangelogEntry | null = null;
	let section: ChangelogSection | null = null;

	for (const rawLine of markdown.split('\n')) {
		const line = rawLine.trimEnd();

		const versionMatch = line.match(/^##\s+(.+)/);
		if (versionMatch) {
			const { version, date } = parseVersionHeading(versionMatch[1]);
			entry = { version, date, sections: [] };
			section = null;
			entries.push(entry);
			continue;
		}

		// Skip anything before the first version heading (title + preamble).
		if (!entry) continue;

		const sectionMatch = line.match(/^###\s+(.+)/);
		if (sectionMatch) {
			section = { title: sectionMatch[1].trim(), items: [] };
			entry.sections.push(section);
			continue;
		}

		const bulletMatch = line.match(/^[-*]\s+(.+)/);
		if (bulletMatch) {
			if (!section) {
				// Items before any `###` heading: attach to an untitled section.
				section = { title: '', items: [] };
				entry.sections.push(section);
			}
			section.items.push(stripInlineMarkdown(bulletMatch[1].trim()));
		}
	}

	return entries;
}

/**
 * Render parsed changelog entries into a container using `createEl`. The entry
 * whose version equals `currentVersion` is marked with a modifier class so the
 * installed release can be visually highlighted.
 */
export function renderChangelog(
	container: HTMLElement,
	markdown: string,
	currentVersion?: string,
): void {
	const entries = parseChangelog(markdown);

	if (entries.length === 0) {
		container.createEl('p', {
			text: 'No changelog entries found.',
			cls: 'synapse-changelog-empty',
		});
		return;
	}

	for (const entry of entries) {
		const entryEl = container.createDiv({ cls: 'synapse-changelog-entry' });
		if (currentVersion && entry.version === currentVersion) {
			entryEl.addClass('synapse-changelog-entry--current');
		}

		const headingText = entry.date ? `${entry.version} — ${entry.date}` : entry.version;
		entryEl.createEl('h3', { text: headingText, cls: 'synapse-changelog-version' });

		for (const section of entry.sections) {
			if (section.title) {
				entryEl.createEl('h4', {
					text: section.title,
					cls: 'synapse-changelog-section',
				});
			}
			if (section.items.length > 0) {
				const list = entryEl.createEl('ul', { cls: 'synapse-changelog-list' });
				for (const item of section.items) {
					list.createEl('li', { text: item });
				}
			}
		}
	}
}
