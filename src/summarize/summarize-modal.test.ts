import { describe, it, expect, vi, beforeEach } from 'vitest';

const { settingNames } = vi.hoisted(() => ({ settingNames: [] as string[] }));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<any>();
	class TrackedSetting {
		constructor(_el: unknown) {}
		setName = vi.fn((n: string) => { settingNames.push(n); return this; });
		setDesc = vi.fn().mockReturnThis();
		addToggle = vi.fn((cb: (t: any) => void) => {
			cb({ setValue: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis() });
			return this;
		});
		addButton = vi.fn((cb: (b: any) => void) => {
			cb({ setButtonText: vi.fn().mockReturnThis(), setCta: vi.fn().mockReturnThis(), onClick: vi.fn().mockReturnThis() });
			return this;
		});
	}
	return { ...actual, Setting: TrackedSetting };
});

import { SummarizeSelectionModal, SummarizeModalDefaults } from './summarize-modal';
import { SummarizeTarget } from './types';

const COMBINE_LABEL = 'Combine into one summary';
const NOTE_LABEL = 'Include note content';

function stubEl(): any {
	return { empty: vi.fn(), createEl: vi.fn(() => stubEl()), createDiv: vi.fn(() => stubEl()) };
}

const refTargets = (): SummarizeTarget[] => [
	{ type: 'audio', source: 'part1.mp3', line: 2, endLine: 2 },
	{ type: 'url', source: 'https://example.com', line: 4, endLine: 4 },
];

const noteContentTarget = (): SummarizeTarget => ({
	type: 'note-content', source: 'My Note', line: 9, endLine: 9, content: 'Prose.',
});

const DEFAULTS: SummarizeModalDefaults = { includeNoteContent: true, combineSummaries: true };

function openModal(targets: SummarizeTarget[], defaults: SummarizeModalDefaults = DEFAULTS) {
	const modal = new SummarizeSelectionModal(
		{} as any,
		targets,
		vi.fn().mockResolvedValue(undefined),
		defaults
	);
	(modal as any).contentEl = stubEl();
	modal.onOpen();
	return modal;
}

describe('SummarizeSelectionModal toggles (#367)', () => {
	beforeEach(() => {
		settingNames.length = 0;
	});

	it('always renders the combine toggle', () => {
		openModal(refTargets());
		expect(settingNames).toContain(COMBINE_LABEL);
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
		expect((modal as any).includeNote).toBe(false);
		expect((modal as any).combine).toBe(false);
	});

	it('includes the note-content target in the selection when its toggle is on', () => {
		const modal = openModal([...refTargets(), noteContentTarget()]);
		(modal as any).includeNote = true;
		const chosen = (modal as any).collectChosen() as SummarizeTarget[];
		expect(chosen.some((t) => t.type === 'note-content')).toBe(true);
		expect(chosen).toHaveLength(3);
	});

	it('excludes the note-content target when its toggle is off', () => {
		const modal = openModal([...refTargets(), noteContentTarget()]);
		(modal as any).includeNote = false;
		const chosen = (modal as any).collectChosen() as SummarizeTarget[];
		expect(chosen.some((t) => t.type === 'note-content')).toBe(false);
		// Reference targets remain selected by default.
		expect(chosen).toHaveLength(2);
	});
});
