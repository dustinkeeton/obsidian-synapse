import { describe, it, expect, vi, beforeEach } from 'vitest';

interface TrackedToggleSetting {
	name: string;
	settingEl: { hasClass: (cls: string) => boolean };
	toggleChange?: (value: boolean) => void;
}

const { settingNames, trackedSettings, buttonClicks } = vi.hoisted(() => ({
	settingNames: [] as string[],
	trackedSettings: [] as TrackedToggleSetting[],
	buttonClicks: new Map<string, () => unknown>(),
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	const stubEl = (actual as unknown as { createEl: () => TrackedToggleSetting['settingEl'] }).createEl;
	class TrackedSetting implements TrackedToggleSetting {
		name = '';
		settingEl = stubEl();
		toggleChange?: (value: boolean) => void;
		constructor(_el: unknown) {
			trackedSettings.push(this);
		}
		setName = vi.fn((n: string) => { this.name = n; settingNames.push(n); return this; });
		setDesc = vi.fn().mockReturnThis();
		addToggle = vi.fn((cb: (t: unknown) => void) => {
			cb({
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn((fn: (value: boolean) => void) => { this.toggleChange = fn; }),
			});
			return this;
		});
		addButton = vi.fn((cb: (b: unknown) => void) => {
			let text = '';
			const btn = {
				setButtonText: vi.fn((t: string) => { text = t; return btn; }),
				setCta: vi.fn(() => btn),
				onClick: vi.fn((fn: () => unknown) => { buttonClicks.set(text, fn); return btn; }),
			};
			cb(btn);
			return this;
		});
	}
	return { ...actual, Setting: TrackedSetting };
});

import { SummarizeSelectionModal, SummarizeModalDefaults, countCombinable } from './summarize-modal';
import { SummarizeTarget } from './types';
import type { App } from 'obsidian';
import type { NotificationManager } from '../shared';
import { createEl } from '../__mocks__/obsidian';

const COMBINE_LABEL = 'Combine into one summary';
const NOTE_LABEL = 'Include note content';

/** Typed view of the modal's private toggle state / selection internals. */
function internals(modal: SummarizeSelectionModal): {
	includeNote: boolean;
	combine: boolean;
	collectChosen: () => SummarizeTarget[];
} {
	return modal as unknown as {
		includeNote: boolean;
		combine: boolean;
		collectChosen: () => SummarizeTarget[];
	};
}

const refTargets = (): SummarizeTarget[] => [
	{ type: 'audio', source: 'part1.mp3', line: 2, endLine: 2 },
	{ type: 'url', source: 'https://example.com', line: 4, endLine: 4 },
];

const noteContentTarget = (): SummarizeTarget => ({
	type: 'note-content', source: 'My Note', line: 9, endLine: 9, content: 'Prose.',
});

const DEFAULTS: SummarizeModalDefaults = { includeNoteContent: true, combineSummaries: true };

function openModal(
	targets: SummarizeTarget[],
	defaults: SummarizeModalDefaults = DEFAULTS,
	onSummarize: (targets: SummarizeTarget[], combine: boolean) => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
	const modal = new SummarizeSelectionModal(
		{} as unknown as App,
		targets,
		onSummarize,
		defaults,
		{ info: vi.fn() } as unknown as NotificationManager,
	);
	(modal as unknown as { contentEl: HTMLElement }).contentEl = createEl();
	modal.onOpen();
	return modal;
}

/** Latest rendered setting with this label (re-renders push new entries). */
function lastSetting(name: string): TrackedToggleSetting {
	const found = [...trackedSettings].reverse().find((s) => s.name === name);
	if (!found) throw new Error(`no setting named ${name}`);
	return found;
}

const enrichmentRef = (): SummarizeTarget => ({
	type: 'url', source: 'https://example.com/ref', line: 6, endLine: 6, inEnrichmentSection: true, linkTitle: 'Ref',
});

describe('countCombinable', () => {
	it('counts every target except enrichment references', () => {
		expect(countCombinable([...refTargets(), noteContentTarget(), enrichmentRef()])).toBe(3);
	});

	it('returns 0 for an empty selection', () => {
		expect(countCombinable([])).toBe(0);
	});
});

describe('SummarizeSelectionModal toggles (#367)', () => {
	beforeEach(() => {
		settingNames.length = 0;
		trackedSettings.length = 0;
		buttonClicks.clear();
	});

	it('renders the combine toggle when two combinable items exist', () => {
		openModal(refTargets());
		expect(settingNames).toContain(COMBINE_LABEL);
	});

	it('omits the combine toggle when only one combinable item exists (#544)', () => {
		openModal([refTargets()[0], enrichmentRef()]);
		expect(settingNames).not.toContain(COMBINE_LABEL);
	});

	it('hides the combine toggle while fewer than two combinable items are selected (#544)', () => {
		openModal(refTargets());
		const el = lastSetting(COMBINE_LABEL).settingEl;
		expect(el.hasClass('is-hidden')).toBe(false);

		lastSetting('URL: https://example.com').toggleChange?.(false);
		expect(el.hasClass('is-hidden')).toBe(true);

		buttonClicks.get('Select all')?.();
		expect(el.hasClass('is-hidden')).toBe(false);

		buttonClicks.get('Select none')?.();
		expect(el.hasClass('is-hidden')).toBe(true);
	});

	it('counts note content toward the combine threshold (#544)', () => {
		openModal([refTargets()[0], noteContentTarget()], { includeNoteContent: false, combineSummaries: true });
		const el = lastSetting(COMBINE_LABEL).settingEl;
		expect(el.hasClass('is-hidden')).toBe(true);

		lastSetting(NOTE_LABEL).toggleChange?.(true);
		expect(el.hasClass('is-hidden')).toBe(false);
	});

	it('never hands a single chosen item to the combined path (#544)', async () => {
		const onSummarize = vi.fn().mockResolvedValue(undefined);
		openModal(refTargets(), DEFAULTS, onSummarize);
		lastSetting('URL: https://example.com').toggleChange?.(false);

		await buttonClicks.get('Summarize selected')?.();

		expect(onSummarize).toHaveBeenCalledWith([expect.objectContaining({ source: 'part1.mp3' })], false);
	});

	it('keeps combine on when two or more items are chosen', async () => {
		const onSummarize = vi.fn().mockResolvedValue(undefined);
		openModal(refTargets(), DEFAULTS, onSummarize);

		await buttonClicks.get('Summarize selected')?.();

		expect(onSummarize).toHaveBeenCalledTimes(1);
		expect(onSummarize.mock.calls[0][0]).toHaveLength(2);
		expect(onSummarize.mock.calls[0][1]).toBe(true);
	});

	it('renders the include-note-content toggle when note content is present', () => {
		openModal([...refTargets(), noteContentTarget()]);
		expect(settingNames).toContain(NOTE_LABEL);
	});

	it('omits the include-note-content toggle when there is no note content', () => {
		openModal(refTargets());
		expect(settingNames).not.toContain(NOTE_LABEL);
	});

	it('initializes toggle state from the provided defaults', () => {
		const modal = openModal([...refTargets(), noteContentTarget()], {
			includeNoteContent: false,
			combineSummaries: false,
		});
		expect(internals(modal).includeNote).toBe(false);
		expect(internals(modal).combine).toBe(false);
	});

	it('includes the note-content target in the selection when its toggle is on', () => {
		const modal = openModal([...refTargets(), noteContentTarget()]);
		internals(modal).includeNote = true;
		const chosen = internals(modal).collectChosen();
		expect(chosen.some((t) => t.type === 'note-content')).toBe(true);
		expect(chosen).toHaveLength(3);
	});

	it('excludes the note-content target when its toggle is off', () => {
		const modal = openModal([...refTargets(), noteContentTarget()]);
		internals(modal).includeNote = false;
		const chosen = internals(modal).collectChosen();
		expect(chosen.some((t) => t.type === 'note-content')).toBe(false);
		// Reference targets remain selected by default.
		expect(chosen).toHaveLength(2);
	});
});
