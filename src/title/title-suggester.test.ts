import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TitleSuggester } from './title-suggester';

describe('TitleSuggester', () => {
	let suggester: TitleSuggester;
	let mockComplete: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockComplete = vi.fn();
		const mockAIClient = { complete: mockComplete } as any;
		suggester = new TitleSuggester(mockAIClient);
	});

	describe('suggestTitle', () => {
		it('parses a well-formed AI response', async () => {
			mockComplete.mockResolvedValue(
				'TITLE: Weekly Team Standup Notes\nREASON: The note contains meeting notes from a weekly standup'
			);

			const result = await suggester.suggestTitle('Some meeting content...', 'Untitled');

			expect(result.title).toBe('Weekly Team Standup Notes');
			expect(result.reasoning).toBe('The note contains meeting notes from a weekly standup');
		});

		it('sanitizes invalid filename characters from title', async () => {
			mockComplete.mockResolvedValue(
				'TITLE: What/Why: The Question?\nREASON: reason'
			);

			const result = await suggester.suggestTitle('content', 'Untitled');
			expect(result.title).not.toContain('/');
			expect(result.title).not.toContain(':');
			expect(result.title).not.toContain('?');
		});

		it('provides default values for malformed response', async () => {
			mockComplete.mockResolvedValue('This is just random text without the expected format');

			const result = await suggester.suggestTitle('content', 'Untitled');
			expect(result.title).toBe('Untitled Note');
			expect(result.reasoning).toBe('AI-suggested title based on note content');
		});

		it('truncates content to 4000 characters', async () => {
			mockComplete.mockResolvedValue('TITLE: Test\nREASON: reason');
			const longContent = 'x'.repeat(5000);

			await suggester.suggestTitle(longContent, 'Untitled');

			const passedPrompt = mockComplete.mock.calls[0][0];
			expect(passedPrompt.length).toBeLessThan(5000);
		});
	});

	describe('checkTitleMismatch', () => {
		it('returns no mismatch when AI says YES', async () => {
			mockComplete.mockResolvedValue('MATCH: YES');

			const result = await suggester.checkTitleMismatch('content', 'Good Title');
			expect(result.isMismatch).toBe(false);
		});

		it('returns mismatch with suggested title when AI says NO', async () => {
			mockComplete.mockResolvedValue(
				'MATCH: NO\nTITLE: Better Title Here\nREASON: The original title is about X but the content is about Y'
			);

			const result = await suggester.checkTitleMismatch('content', 'Old Title');
			expect(result.isMismatch).toBe(true);
			expect(result.suggestedTitle).toBe('Better Title Here');
			expect(result.reasoning).toContain('original title');
		});

		it('handles missing MATCH line as no mismatch', async () => {
			mockComplete.mockResolvedValue('Some unexpected response');

			const result = await suggester.checkTitleMismatch('content', 'Title');
			expect(result.isMismatch).toBe(false);
		});
	});
});
