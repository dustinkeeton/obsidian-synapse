import type { App } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { DecisionClient, MAX_CHOICE_OPTIONS, choice } from '../shared';
import type { ChoiceAnswer, ChoiceQuestion, DecisionRequestOptions } from '../shared';
import { DirectoryMatcher } from './directory-matcher';
import type { Placement } from './types';

/** Choice option for "no existing folder fits"; `<` cannot appear in a vault folder name. */
export const NEW_DIRECTORY_OPTION = '<new-directory>';
const STATE_MAX_CHARS = 3000;
/** Leaves one slot per question for {@link NEW_DIRECTORY_OPTION}. */
const DIRECTORIES_PER_QUESTION = MAX_CHOICE_OPTIONS - 1;

/**
 * System 1 directory placement (#558): a `choice` over the vault's existing
 * folders plus "new directory". Returns `null` when the lane picks a new
 * directory or the vault has no folders; throws on lane errors so the
 * confidence router can fall back to topic extraction.
 */
export class PlacementDecider {
	private readonly client: DecisionClient;
	private readonly matcher: DirectoryMatcher;

	constructor(app: App, getSettings: () => SynapseSettings) {
		this.client = new DecisionClient(getSettings);
		this.matcher = new DirectoryMatcher(app);
	}

	isAvailable(): boolean {
		return this.client.isEnabled();
	}

	async decide(body: string, tags: string[], aiOpts?: DecisionRequestOptions): Promise<Placement | null> {
		const trimmed = body.trim();
		if (!trimmed) return null;
		const directories = this.matcher.collectDirectories();
		if (directories.length === 0) return null;

		const state =
			`Note content:\n${trimmed.slice(0, STATE_MAX_CHARS)}` +
			(tags.length > 0 ? `\n\nExisting tags: ${tags.join(', ')}` : '');

		// Folders beyond the 255-option cap are split across questions; a second round settles competing winners.
		const groups: string[][] = [];
		for (let i = 0; i < directories.length; i += DIRECTORIES_PER_QUESTION) {
			groups.push(directories.slice(i, i + DIRECTORIES_PER_QUESTION));
		}
		const questions: Record<string, ChoiceQuestion> = {};
		groups.forEach((group, i) => { questions[`p${i}`] = this.question(group); });

		const { answers } = await this.client.decide(state, questions, aiOpts);
		const winners = Object.values(answers)
			.map((a) => this.toPlacement(a, directories))
			.filter((p): p is Placement => p !== null);
		if (winners.length <= 1) return winners[0] ?? null;

		const { answers: final } = await this.client.decide(
			state,
			{ final: this.question(winners.map((w) => w.directoryPath)) },
			aiOpts,
		);
		return this.toPlacement(final.final, directories);
	}

	private question(directories: string[]): ChoiceQuestion {
		const criteria: Record<string, string | null> = {};
		for (const dir of directories) criteria[dir] = null;
		criteria[NEW_DIRECTORY_OPTION] = 'No existing folder fits this note; a new folder should be proposed.';
		return choice(
			'Which existing folder should this note live in? Prefer an existing folder whenever the note fits its topic.',
			criteria,
		);
	}

	private toPlacement(answer: ChoiceAnswer, directories: string[]): Placement | null {
		if (answer.choice === NEW_DIRECTORY_OPTION || !directories.includes(answer.choice)) return null;
		return { directoryPath: answer.choice, confidence: answer.confidence };
	}
}
