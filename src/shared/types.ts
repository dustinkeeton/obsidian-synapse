export interface ImageContentBlock {
	type: 'image';
	/** base64-encoded image data */
	data: string;
	/** MIME type, e.g. 'image/png' */
	mediaType: string;
}

export interface TextContentBlock {
	type: 'text';
	text: string;
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string | ContentBlock[];
}
