import { findUrls } from './url-classifier';

/** Fewer letters/digits than this after reduction counts as no prose (~one word). */
export const MIN_PROSE_CHARS = 10;

/** Replace every bare URL with a space, splicing from the end so earlier offsets stay valid. */
export function stripUrls(text: string): string {
	let out = text;
	for (const { url, index } of findUrls(text).reverse()) {
		out = out.slice(0, index) + ' ' + out.slice(index + url.length);
	}
	return out;
}

/** The text minus its references: URLs and `![[embeds]]` removed, links reduced to their label, rules and empty headings dropped. */
export function reduceToProse(text: string): string {
	if (typeof text !== 'string' || text.length === 0) {
		return '';
	}
	return stripUrls(text)
		.replace(/!\[\[[^\]]*\]\]/g, ' ')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
		.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
		.replace(/^[ \t]*#{1,6}[ \t]*$/gm, '');
}

/** Letters and digits left after {@link reduceToProse}; markdown punctuation never inflates it. */
export function proseCharCount(text: string): number {
	return reduceToProse(text).replace(/[^\p{L}\p{N}]+/gu, '').length;
}

/** True when the text is just its references (links, embeds, rules) with no real prose. */
export function isEffectivelyEmptyProse(text: string): boolean {
	return proseCharCount(text) < MIN_PROSE_CHARS;
}
