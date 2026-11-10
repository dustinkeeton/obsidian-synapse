export interface OCRResult {
	/** Extracted text from the image */
	text: string;
	/** Source image file name */
	sourceName?: string;
}
