import { TFile } from 'obsidian';

export interface ImageEmbed {
	fileName: string;
	file: TFile;
	line: number;
}

export interface OCRResult {
	/** Extracted text from the image */
	text: string;
	/** Source image file name */
	sourceName?: string;
}
