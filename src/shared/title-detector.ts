/**
 * Note-title predicates shared across features. These live in `shared/` (not the
 * `title/` feature module) so that other features -- e.g. elaboration's
 * anti-fabrication guard -- can reuse them without importing from another feature
 * module, which the dependency rules forbid. The `title/` module re-exports
 * `isUntitled` from here to preserve its public surface.
 */

/**
 * Checks whether a note title matches Obsidian's "Untitled" default pattern.
 * Matches "Untitled", "Untitled 1", "Untitled 2", etc. (case-insensitive).
 */
export function isUntitled(title: string): boolean {
	return /^untitled(\s+\d+)?$/i.test(title.trim());
}

const inMonthRange = (n: number): boolean => n >= 1 && n <= 12;
const inDayRange = (n: number): boolean => n >= 1 && n <= 31;

/**
 * True when the whole title is a date-style daily-note name. Obsidian's default
 * daily-note format is `YYYY-MM-DD`; users commonly swap the separator (`/`, `.`,
 * `_`), drop it entirely (`YYYYMMDD`), or put the year last (`DD-MM-YYYY` /
 * `MM-DD-YYYY`). Month and day ranges are validated so a non-date like
 * "2026-99-99" -- or an ordinary title that merely starts with a year -- is not
 * mistaken for a date.
 */
function isDateStyleTitle(title: string): boolean {
	const t = title.trim();

	// YYYY<sep>MM<sep>DD with a single, consistent separator (-, /, ., _).
	const ymd = /^(\d{4})([-/._])(\d{1,2})\2(\d{1,2})$/.exec(t);
	if (ymd) return inMonthRange(Number(ymd[3])) && inDayRange(Number(ymd[4]));

	// Compact, separator-less YYYYMMDD.
	const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
	if (compact) return inMonthRange(Number(compact[2])) && inDayRange(Number(compact[3]));

	// Year-last DD<sep>MM<sep>YYYY or MM<sep>DD<sep>YYYY -- either order accepted,
	// as long as one field is a valid month and the other a valid day.
	const yearLast = /^(\d{1,2})([-/._])(\d{1,2})\2(\d{4})$/.exec(t);
	if (yearLast) {
		const a = Number(yearLast[1]);
		const b = Number(yearLast[3]);
		return (inMonthRange(a) && inDayRange(b)) || (inMonthRange(b) && inDayRange(a));
	}

	return false;
}

/**
 * True when the entire title is just a bare URL (an `http(s)://` link or a `www.`
 * host). A note whose title is only a link carries no topical signal of its own.
 */
function isBareUrlTitle(title: string): boolean {
	const t = title.trim();
	return /^https?:\/\/\S+$/i.test(t) || /^www\.\S+\.\S+$/i.test(t);
}

/**
 * True when a title carries no topical signal of its own: one of Obsidian's
 * "Untitled" defaults, a date-style daily-note name, or a bare URL.
 *
 * Used by elaboration's anti-fabrication guard: an empty note with a generic
 * title gives the AI nothing real to work from, so we refuse rather than
 * fabricate content out of the filename alone. A real title like "Photosynthesis"
 * is NOT generic and can seed a title-led proposal.
 */
export function isGenericTitle(title: string): boolean {
	return isUntitled(title) || isDateStyleTitle(title) || isBareUrlTitle(title);
}
