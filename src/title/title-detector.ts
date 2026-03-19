/**
 * Checks whether a note title matches Obsidian's "Untitled" default pattern.
 * Matches "Untitled", "Untitled 1", "Untitled 2", etc. (case-insensitive).
 */
export function isUntitled(title: string): boolean {
	return /^untitled(\s+\d+)?$/i.test(title.trim());
}
