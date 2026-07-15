import { SynapseSettings } from '../settings';
import { AIClient, sanitizeAIResponse } from '../shared';

/**
 * Rough chars-per-token estimate for English text, used by the output-budget
 * guard below. Deliberately conservative (real ratios are usually higher).
 */
const CHARS_PER_TOKEN = 4;

export class PostProcessor {
	private aiClient: AIClient;

	constructor(private getSettings: () => SynapseSettings) {
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

		// Output-budget guard (#466): post-processing REWRITES the transcript,
		// so the response needs roughly as many tokens as the input. Every
		// provider dispatch caps responses at ai.maxTokens; past that the model
		// silently truncates and the cut-off text would land in `processed`,
		// which every consumer prefers over `raw`. A raw-but-complete
		// transcript beats a clean-but-truncated one, so skip the AI pass for
		// transcripts that clearly exceed the budget. Chunked processing for
		// long transcripts is #467.
		const estimatedTokens = Math.ceil(rawTranscript.length / CHARS_PER_TOKEN);
		const { maxTokens } = this.getSettings().ai;
		if (estimatedTokens > maxTokens) {
			console.warn(
				`[Synapse] Transcript needs ~${estimatedTokens} output tokens but the AI max tokens setting is ${maxTokens}; ` +
				'skipping post-processing to avoid truncation (raise Max tokens in AI settings to post-process long transcripts)'
			);
			return rawTranscript;
		}

		const systemPrompt =
			'You are a transcription editor. Process the following raw transcript according to the instructions. ' +
			'Preserve all meaning and key information. Output only the processed transcript.';

		const prompt =
			`Instructions:\n${instructions.map((i) => `- ${i}`).join('\n')}\n\n` +
			`Raw transcript:\n${rawTranscript}`;

		const response = await this.aiClient.complete(prompt, systemPrompt);
		return sanitizeAIResponse(response);
	}
}
