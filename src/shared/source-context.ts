import type { RegionLocator } from './insertion-point';

/** An image found on the material an action acted on (fetched page, video, note). */
export interface SourceImage {
	url: string;
	alt?: string;
	/** Page the image was taken from; doubles as its attribution target. */
	pageUrl: string;
	title?: string;
}

/** What a completed action hands to post-op follow-ups about the material it processed. */
export interface SourceContext {
	sourceUrls?: string[];
	sourceImages?: SourceImage[];
	/** The part of the note the action wrote, so a follow-up places content inside it. */
	producedRegion?: RegionLocator;
}
