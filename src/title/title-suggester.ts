import { AIClient, sanitizeAIResponse, stripCodeFences } from '../shared';

/**
 * Uses the AI client to suggest a concise, descriptive title for a note
 * based on its content.
 */
export class TitleSuggester {
	constructor(private aiClient: AIClient) {}

	async suggestTitle(content: string, currentTitle: string): Promise<{ title: string; reasoning: string }> {
		const truncated = content.slice(0, 4000);

		const systemPrompt = [
			'You are a note-titling assistant. Given the content of a note, suggest a concise, descriptive title.',
			'Rules:',
			'- The title should be 2-8 words long',
			'- It should capture the main topic or purpose of the note',
			'- Use title case',
			'- Do not use special characters that are invalid in file names (: / \\ | ? * " < >)',
			'- Do not wrap the title in quotes',
			'',
			'Respond in this exact format:',
			'TITLE: <your suggested title>',
			'REASON: <one sentence explaining why this title fits>',
		].join('\n');

		const prompt = [
			`Current title: ${currentTitle}`,
			'',
			'Note content:',
			truncated,
		].join('\n');

		const response = stripCodeFences(sanitizeAIResponse(
			await this.aiClient.complete(prompt, systemPrompt)
		));

		return this.parseResponse(response);
	}

	async checkTitleMismatch(content: string, currentTitle: string): Promise<{ isMismatch: boolean; suggestedTitle?: string; reasoning?: string }> {
		const truncated = content.slice(0, 4000);

		const systemPrompt = [
			'You are a note-titling assistant. Given a note\'s current title and its content, determine if the title accurately reflects the content.',
			'',
			'Respond in this exact format:',
			'MATCH: YES or NO',
			'If NO, also include:',
			'TITLE: <your suggested title (2-8 words, title case, no special file-name characters)>',
			'REASON: <one sentence explaining the mismatch>',
		].join('\n');

		const prompt = [
			`Current title: ${currentTitle}`,
			'',
			'Note content:',
			truncated,
		].join('\n');

		const response = stripCodeFences(sanitizeAIResponse(
			await this.aiClient.complete(prompt, systemPrompt)
		));

		return this.parseMismatchResponse(response);
	}

	private parseResponse(response: string): { title: string; reasoning: string } {
		const titleMatch = response.match(/TITLE:\s*(.+)/i);
		const reasonMatch = response.match(/REASON:\s*(.+)/i);

		const title = this.sanitizeTitle(titleMatch?.[1]?.trim() || 'Untitled Note');
		const reasoning = reasonMatch?.[1]?.trim() || 'AI-suggested title based on note content';

		return { title, reasoning };
	}

	private parseMismatchResponse(response: string): { isMismatch: boolean; suggestedTitle?: string; reasoning?: string } {
		const matchLine = response.match(/MATCH:\s*(YES|NO)/i);
		if (!matchLine || matchLine[1].toUpperCase() === 'YES') {
			return { isMismatch: false };
		}

		const titleMatch = response.match(/TITLE:\s*(.+)/i);
		const reasonMatch = response.match(/REASON:\s*(.+)/i);

		return {
			isMismatch: true,
			suggestedTitle: this.sanitizeTitle(titleMatch?.[1]?.trim() || ''),
			reasoning: reasonMatch?.[1]?.trim() || 'Title does not reflect current content',
		};
	}

	/**
	 * Strip characters that are invalid in file names.
	 */
	private sanitizeTitle(title: string): string {
		return title
			.replace(/[:\\|?*"<>/]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}
}
