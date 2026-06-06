import type { TFile } from 'obsidian';
import type { ParsedNote } from '../shared';
import { classifyUrl, extractUrls } from '../shared';
import type { IntakeRoute } from './types';

/**
 * Pure routing for the intake monitor: given a note plus its parsed
 * frontmatter/body, decide which processing branch applies and return a
 * typed {@link IntakeRoute}. No Obsidian writes happen here, so the policy is
 * unit-testable in isolation.
 *
 * The central question is "is this note essentially just one URL?" (the
 * share-to-vault / quick-capture case). If so, the URL is classified and
 * routed to transcription (video/audio) or article fetching; an `unknown`
 * URL, prose, multiple URLs, or plain text all fall through to the general
 * pipeline.
 */
export class IntakeDispatcher {
	/**
	 * Determine the route for a parsed intake note.
	 *
	 * `file` is currently only used for symmetry with the processor and future
	 * path-based heuristics; routing decisions are made entirely from `parsed`.
	 */
	route(file: TFile, parsed: ParsedNote): IntakeRoute {
		void file;

		const url = this.bareUrl(parsed.body);
		if (url === null) {
			return { kind: 'general' };
		}

		const classification = classifyUrl(url);
		switch (classification.type) {
			case 'video':
			case 'audio':
				return { kind: 'transcription', url, mediaType: classification.type };
			case 'article':
				return { kind: 'article', url };
			case 'unknown':
			default:
				// A lone URL we can't classify (e.g. rejected by sanitizeUrl) is
				// not fetchable as an article, so treat the note as general prose.
				return { kind: 'general' };
		}
	}

	/**
	 * Return the single URL when the body is "essentially just one URL":
	 * exactly one URL is present AND, once that URL is removed, only
	 * whitespace remains (i.e. the body IS the URL modulo trailing/leading
	 * whitespace). Returns null otherwise — including when there are zero or
	 * multiple URLs, or the URL is surrounded by other prose.
	 */
	private bareUrl(body: string): string | null {
		const urls = extractUrls(body);
		if (urls.length !== 1) {
			return null;
		}

		const url = urls[0];
		// Strip the first occurrence of the URL and require the remainder to be
		// blank. This rejects "see <url> for details" while accepting a body
		// that is just the URL (possibly with surrounding whitespace/newlines).
		const remainder = body.replace(url, '').trim();
		return remainder.length === 0 ? url : null;
	}
}
