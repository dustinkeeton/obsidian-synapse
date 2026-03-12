import { requestUrl } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { TranscriptionResult } from './types';

export class Transcriber {
	constructor(private getSettings: () => AutoNotesSettings) {}

	async transcribe(
		audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		const settings = this.getSettings().audio;

		switch (settings.transcriptionProvider) {
			case 'whisper-api':
				return this.transcribeWhisperAPI(audioData, fileName);
			case 'deepgram':
				return this.transcribeDeepgram(audioData, fileName);
			case 'local-whisper':
				return this.transcribeLocalWhisper(audioData, fileName);
			default:
				throw new Error(
					`Unsupported transcription provider: ${settings.transcriptionProvider}`
				);
		}
	}

	private async transcribeWhisperAPI(
		audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		const settings = this.getSettings();
		const formData = new FormData();
		formData.append(
			'file',
			new Blob([audioData]),
			fileName
		);
		formData.append('model', settings.audio.whisperModel);
		if (settings.audio.language) {
			formData.append('language', settings.audio.language);
		}
		formData.append('response_format', 'verbose_json');

		const response = await fetch(
			'https://api.openai.com/v1/audio/transcriptions',
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${settings.ai.apiKey}`,
				},
				body: formData,
			}
		);

		const data = await response.json();
		return {
			raw: data.text,
			language: data.language,
			duration: data.duration,
			sourceName: fileName,
			timestamps: data.segments?.map(
				(s: { start: number; end: number; text: string }) => ({
					start: s.start,
					end: s.end,
					text: s.text,
				})
			),
		};
	}

	private async transcribeDeepgram(
		audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		const settings = this.getSettings().audio;
		const params = new URLSearchParams({
			punctuate: 'true',
			paragraphs: 'true',
		});
		if (settings.language) {
			params.set('language', settings.language);
		}

		const response = await requestUrl({
			url: `https://api.deepgram.com/v1/listen?${params}`,
			method: 'POST',
			headers: {
				Authorization: `Token ${settings.deepgramApiKey}`,
				'Content-Type': 'audio/*',
			},
			body: audioData,
		});

		const result = response.json.results.channels[0].alternatives[0];
		return {
			raw: result.transcript,
			language: response.json.results.channels[0].detected_language,
			sourceName: fileName,
		};
	}

	private async transcribeLocalWhisper(
		_audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		// Local whisper requires writing to temp file and running CLI
		// This will be implemented via child_process in the video module pattern
		throw new Error(
			'Local Whisper transcription not yet implemented. ' +
			'Please use whisper-api or deepgram provider.'
		);
	}
}
