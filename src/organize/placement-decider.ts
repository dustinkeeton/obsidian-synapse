import type { App } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { DecisionClient, MAX_CHOICE_OPTIONS, choice, isPathExcluded } from '../shared';
import type { ChoiceAnswer, ChoiceQuestion, DecisionRequestOptions } from '../shared';
import { DirectoryMatcher } from './directory-matcher';
import { canonicalKey } from './folder-normalize';
import type { Placement } from './types';

/** Choice option for "no existing folder fits"; `<` cannot appear in a vault folder name. */
export const NEW_DIRECTORY_OPTION = '<new-directory>';
/** Existing-folder acceptance: a strict majority of the runoff mass on one folder. Fixed by design, not a setting. */
export const PLACEMENT_MAJORITY = 0.5;
/** Folders carried from the first round into the runoff. */
export const RUNOFF_SIZE = 5;
const STATE_MAX_CHARS = 3000;
/** Leaves one slot per question for {@link NEW_DIRECTORY_OPTION}. */
const DIRECTORIES_PER_QUESTION = MAX_CHOICE_OPTIONS - 1;
/** Stand-in child path so folder-scoped exclusion patterns (`dir/**`, `dir/*`) match the folder itself. */
const EXCLUSION_PROBE = 'note.md';

interface RunoffOption {
	directoryPath: string;
	probability: number;
}

/**
 * System 1 directory placement (#558): a `choice` over the vault's eligible
 * folders plus "new directory", sharpened by a runoff over the leading few.
 * Returns `null` for a blank body or a vault with no eligible folders; throws
 * on lane errors so the caller falls back to topic extraction.
 */
export class PlacementDecider {
	private readonly client: DecisionClient;
	private readonly matcher: DirectoryMatcher;

	constructor(app: App, private readonly getSettings: () => SynapseSettings) {
		this.client = new DecisionClient(getSettings);
		this.matcher = new DirectoryMatcher(app);
	}

	isAvailable(): boolean {
		return this.client.isEnabled();
	}

	async decide(body: string, tags: string[], aiOpts?: DecisionRequestOptions): Promise<Placement | null> {
		const trimmed = body.trim();
		if (!trimmed) return null;
		const directories = this.candidateDirectories();
		if (directories.length === 0) return null;

		const state =
			`Note content:\n${trimmed.slice(0, STATE_MAX_CHARS)}` +
			(tags.length > 0 ? `\n\nExisting tags: ${tags.join(', ')}` : '');

		const groups: string[][] = [];
		for (let i = 0; i < directories.length; i += DIRECTORIES_PER_QUESTION) {
			groups.push(directories.slice(i, i + DIRECTORIES_PER_QUESTION));
		}
		const questions: Record<string, ChoiceQuestion> = {};
		groups.forEach((group, i) => { questions[`p${i}`] = this.question(group); });

		const { answers } = await this.client.decide(state, questions, aiOpts);
		const shortlist = this.shortlist(Object.values(answers), directories);
		if (shortlist.length === 0) return null;

		// A single first-round question over exactly the shortlist already is the runoff.
		const settled = groups.length === 1 && shortlist.length === directories.length
			? answers.p0
			: (await this.client.decide(
				state,
				{ runoff: this.question(shortlist.map((o) => o.directoryPath)) },
				aiOpts,
			)).answers.runoff;
		return this.resolve(settled, shortlist.map((o) => o.directoryPath));
	}

	/** Vault folders minus hidden ones and those the user's organize exclusions cover; the note's own folder stays eligible. */
	candidateDirectories(): string[] {
		const settings = this.getSettings();
		return this.matcher.collectDirectories().filter((dir) =>
			!dir.split('/').some((segment) => segment.startsWith('.')) &&
			!isPathExcluded(dir, 'organize', settings) &&
			!isPathExcluded(`${dir}/${EXCLUSION_PROBE}`, 'organize', settings)
		);
	}

	/** Top {@link RUNOFF_SIZE} existing folders by summed first-round probability, coalesced on the canonical basename. */
	private shortlist(answers: ChoiceAnswer[], directories: string[]): RunoffOption[] {
		const mass = new Map<string, number>();
		for (const answer of answers) {
			for (const [option, probability] of Object.entries(answer.probabilities)) {
				if (option === NEW_DIRECTORY_OPTION || !directories.includes(option)) continue;
				mass.set(option, (mass.get(option) ?? 0) + probability);
			}
		}
		const ranked = [...mass.entries()]
			.filter(([, probability]) => probability > 0)
			.sort((a, b) => b[1] - a[1])
			.slice(0, RUNOFF_SIZE)
			.map(([directoryPath, probability]) => ({ directoryPath, probability }));
		return coalesceByBasename(ranked);
	}

	/**
	 * Decision rule over the runoff answer (options already coalesced):
	 * `<new-directory>` at or above `organize.organizeConfidenceThreshold`
	 * wins; else a strict majority on one existing folder; else the leading
	 * folder is reported undecided.
	 */
	private resolve(answer: ChoiceAnswer, options: string[]): Placement | null {
		const newDirectory = answer.probabilities[NEW_DIRECTORY_OPTION] ?? 0;
		if (newDirectory >= this.getSettings().organize.organizeConfidenceThreshold) {
			return { kind: 'new-directory', confidence: newDirectory };
		}
		const top = options
			.map((directoryPath) => ({ directoryPath, probability: answer.probabilities[directoryPath] ?? 0 }))
			.sort((a, b) => b.probability - a.probability)[0];
		if (!top) return null;
		if (top.probability >= PLACEMENT_MAJORITY) {
			return { kind: 'existing', directoryPath: top.directoryPath, confidence: top.probability };
		}
		return { kind: 'undecided', leading: top.directoryPath, confidence: top.probability };
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
}

/** Sum probabilities of folders sharing a canonical basename; the first path seen represents the group. Preserves order. */
export function coalesceByBasename(options: RunoffOption[]): RunoffOption[] {
	const byKey = new Map<string, RunoffOption>();
	for (const option of options) {
		const key = canonicalKey(option.directoryPath.split('/').pop() ?? option.directoryPath) || option.directoryPath;
		const seen = byKey.get(key);
		if (seen) {
			seen.probability += option.probability;
		} else {
			byKey.set(key, { ...option });
		}
	}
	return [...byKey.values()];
}
