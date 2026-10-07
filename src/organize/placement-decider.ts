import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { DecisionClient, MAX_CHOICE_OPTIONS, choice, isPathExcluded } from '../shared';
import type { ChoiceAnswer, ChoiceQuestion, DecisionRequestOptions } from '../shared';
import { DirectoryMatcher } from './directory-matcher';
import { canonicalKey } from './folder-normalize';
import type { Placement } from './types';

/** Choice option for "no existing folder fits; create one"; `<` cannot appear in a vault folder name. */
export const NEW_DIRECTORY_OPTION = '<new-directory>';
/** Choice option for "leave the note where it is". */
export const KEEP_CURRENT_OPTION = '<keep-current>';
/** Choice option for "no listed folder fits; do not move". */
export const NONE_OPTION = '<none>';
const ESCAPE_OPTIONS = [NEW_DIRECTORY_OPTION, KEEP_CURRENT_OPTION, NONE_OPTION] as const;
/** Existing-folder acceptance: a strict majority of the runoff mass on one folder. Fixed by design, not a setting. */
export const PLACEMENT_MAJORITY = 0.5;
/** Existing-folder acceptance also needs this much summed first-round mass; the runoff may sharpen a leader, never invent one. */
export const FIRST_ROUND_SUPPORT = 0.25;
/** Folders carried from the first round into the runoff. */
export const RUNOFF_SIZE = 5;
/** Note titles quoted per folder rubric, each clipped to this many characters, within a per-folder budget. */
export const RUBRIC_TITLES = 5;
export const RUBRIC_TITLE_CHARS = 40;
export const RUBRIC_MAX_CHARS = 200;
const STATE_MAX_CHARS = 3000;
/** Leaves one slot per question for each escape option. */
const DIRECTORIES_PER_QUESTION = MAX_CHOICE_OPTIONS - ESCAPE_OPTIONS.length;
/** Stand-in child path so folder-scoped exclusion patterns (`dir/**`, `dir/*`) match the folder itself. */
const EXCLUSION_PROBE = 'note.md';

interface RunoffOption {
	directoryPath: string;
	/** Summed first-round mass */
	probability: number;
}

/**
 * System 1 directory placement (#558): a `choice` over the vault's eligible
 * folders — each described by the notes it holds — plus three escape options
 * (new directory, keep current, none), sharpened by a runoff over the leading
 * few. Returns `null` for a blank body or a vault with no eligible folders;
 * throws on lane errors so the caller falls back to topic extraction.
 */
export class PlacementDecider {
	private readonly client: DecisionClient;
	private readonly matcher: DirectoryMatcher;

	constructor(private readonly app: App, private readonly getSettings: () => SynapseSettings) {
		this.client = new DecisionClient(getSettings);
		this.matcher = new DirectoryMatcher(app);
	}

	isAvailable(): boolean {
		return this.client.isEnabled();
	}

	/** `currentDir` is the note's parent folder (`''` for the vault root); it is named in the state and offered only as `<keep-current>`. */
	async decide(body: string, tags: string[], currentDir: string, aiOpts?: DecisionRequestOptions): Promise<Placement | null> {
		const trimmed = body.trim();
		if (!trimmed) return null;
		const directories = this.candidateDirectories().filter((dir) => dir !== currentDir);
		if (directories.length === 0) return null;

		const currentLabel = currentDir || 'vault root';
		const state =
			`Note content:\n${trimmed.slice(0, STATE_MAX_CHARS)}` +
			`\n\nCurrent folder: ${currentLabel}` +
			(tags.length > 0 ? `\n\nExisting tags: ${tags.join(', ')}` : '');
		const folders = this.folderIndex();

		const groups: string[][] = [];
		for (let i = 0; i < directories.length; i += DIRECTORIES_PER_QUESTION) {
			groups.push(directories.slice(i, i + DIRECTORIES_PER_QUESTION));
		}
		const questions: Record<string, ChoiceQuestion> = {};
		groups.forEach((group, i) => { questions[`p${i}`] = this.question(group, folders, currentLabel); });

		const { answers } = await this.client.decide(state, questions, aiOpts);
		const shortlist = this.shortlist(Object.values(answers), directories);
		if (shortlist.length === 0) return null;

		// A single first-round question over exactly the shortlist already is the runoff.
		const settled = groups.length === 1 && shortlist.length === directories.length
			? answers.p0
			: (await this.client.decide(
				state,
				{ runoff: this.question(shortlist.map((o) => o.directoryPath), folders, currentLabel) },
				aiOpts,
			)).answers.runoff;
		return this.resolve(settled, shortlist);
	}

	/** Vault folders minus hidden ones and those the user's organize exclusions cover. */
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
				if (!directories.includes(option)) continue;
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
	 * wins; else an escape option (`<keep-current>` / `<none>`) beating every
	 * folder keeps the note in place; else a folder needs both a strict runoff
	 * majority and {@link FIRST_ROUND_SUPPORT}; else the leading folder is
	 * reported undecided.
	 */
	private resolve(answer: ChoiceAnswer, shortlist: RunoffOption[]): Placement | null {
		const p = (option: string): number => answer.probabilities[option] ?? 0;
		const newDirectory = p(NEW_DIRECTORY_OPTION);
		if (newDirectory >= this.getSettings().organize.organizeConfidenceThreshold) {
			return { kind: 'new-directory', confidence: newDirectory };
		}
		const top = shortlist
			.map((option) => ({ ...option, runoff: p(option.directoryPath) }))
			.sort((a, b) => b.runoff - a.runoff)[0];
		if (!top) return null;
		const stay = Math.max(p(KEEP_CURRENT_OPTION), p(NONE_OPTION));
		if (stay > top.runoff) {
			return { kind: 'keep', confidence: stay };
		}
		if (top.runoff >= PLACEMENT_MAJORITY && top.probability >= FIRST_ROUND_SUPPORT) {
			return { kind: 'existing', directoryPath: top.directoryPath, confidence: top.runoff };
		}
		return { kind: 'undecided', leading: top.directoryPath, confidence: top.runoff };
	}

	private question(directories: string[], folders: Map<string, TFolder>, currentLabel: string): ChoiceQuestion {
		const criteria: Record<string, string | null> = {};
		for (const dir of directories) criteria[dir] = folderRubric(folders.get(dir));
		criteria[NEW_DIRECTORY_OPTION] = 'No existing folder fits this note; a new folder should be proposed.';
		criteria[KEEP_CURRENT_OPTION] = `Leave the note in its current folder: ${currentLabel}.`;
		criteria[NONE_OPTION] = 'No listed folder fits; do not move the note.';
		return choice(
			'Which existing folder should this note live in? Judge each folder by the notes it already holds; choose a folder only when this note belongs beside them.',
			criteria,
		);
	}

	/** Every vault folder by path, so rubrics can read a folder's notes without a per-folder lookup. */
	private folderIndex(): Map<string, TFolder> {
		const index = new Map<string, TFolder>();
		const walk = (folder: TFolder): void => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					index.set(child.path, child);
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());
		return index;
	}
}

/** `Contains notes: "A", "B"` from up to {@link RUBRIC_TITLES} markdown basenames in the folder; `null` for an empty or unknown folder. */
export function folderRubric(folder: TFolder | undefined): string | null {
	if (!folder) return null;
	const titles: string[] = [];
	let chars = 0;
	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== 'md') continue;
		const title = child.basename.length > RUBRIC_TITLE_CHARS
			? `${child.basename.slice(0, RUBRIC_TITLE_CHARS - 1)}…`
			: child.basename;
		if (titles.length >= RUBRIC_TITLES || chars + title.length > RUBRIC_MAX_CHARS) break;
		titles.push(title);
		chars += title.length;
	}
	return titles.length > 0 ? `Contains notes: ${titles.map((t) => `"${t}"`).join(', ')}` : null;
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
