import { AutoNotesSettings } from '../settings';
import { AIClient } from '../shared/ai-client';

export class PostProcessor {
	private aiClient: AIClient;

	constructor(private getSettings: () => AutoNotesSettings) {
		this.aiClient = new AIClient(getSettings);
	}

	async process(rawTranscript: string): Promise<string> {
		const settings = this.getSettings().audio.postProcessing;
		if (!settings.enabled) return rawTranscript;

		const instructions: string[] = [];

		if (settings.removeFiller) {
			instructions.push(
				'Remove filler words (um, uh, like, you know) and false starts'
			);
		}
		if (settings.addStructure) {
			instructions.push(
				'Add proper punctuation, paragraph breaks, and section headers where appropriate'
			);
		}
		if (settings.extractKeyPoints) {
			instructions.push(
				'Add a "Key Points" summary section at the top with bullet points'
			);
		}
		if (settings.customPrompt) {
			instructions.push(settings.customPrompt);
		}

		if (instructions.length === 0) return rawTranscript;

		const systemPrompt =
			'You are a transcription editor. Process the following raw transcript according to the instructions. ' +
			'Preserve all meaning and key information. Output only the processed transcript.';

		const prompt =
			`Instructions:\n${instructions.map((i) => `- ${i}`).join('\n')}\n\n` +
			`Raw transcript:\n${rawTranscript}`;

		return this.aiClient.complete(prompt, systemPrompt);
	}
}
