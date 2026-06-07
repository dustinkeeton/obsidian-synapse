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

import { SummarizeSelectionModal } from './summarize-modal';
import { SummarizeTarget } from './types';

const COMBINE_LABEL = 'Combine audio into one summary';

function stubEl(): any {
	return { empty: vi.fn(), createEl: vi.fn(() => stubEl()), createDiv: vi.fn(() => stubEl()) };
}

function targets(): SummarizeTarget[] {
	return [
		{ type: 'audio', source: 'part1.mp3', line: 2, endLine: 2 },
		{ type: 'audio', source: 'part2.wav', line: 4, endLine: 4 },
	];
}

function openModal(canCombine: boolean) {
	const modal = new SummarizeSelectionModal(
		{} as any,
		targets(),
		vi.fn().mockResolvedValue(undefined),
		canCombine
	);
	(modal as any).contentEl = stubEl();
	modal.onOpen();
	return modal;
}

describe('SummarizeSelectionModal combine toggle gating (#214)', () => {
	beforeEach(() => {
		settingNames.length = 0;
	});

	it('shows the combine toggle when combining is allowed', () => {
		openModal(true);
		expect(settingNames).toContain(COMBINE_LABEL);
	});

	it('hides the combine toggle when combining is not allowed', () => {
		openModal(false);
		expect(settingNames).not.toContain(COMBINE_LABEL);
	});

	it('defaults to no combine toggle when the flag is omitted', () => {
		const modal = new SummarizeSelectionModal({} as any, targets(), vi.fn().mockResolvedValue(undefined));
		(modal as any).contentEl = stubEl();
		modal.onOpen();
		expect(settingNames).not.toContain(COMBINE_LABEL);
	});
});
