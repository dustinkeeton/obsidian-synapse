import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track every Setting name created during onOpen so we can assert the
// combine toggle's presence/absence. vi.hoisted lets the (hoisted) mock
// factory reference this array.
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

import { NoteMediaModal } from './note-media-modal';
import { TFile } from '../__mocks__/obsidian';

const COMBINE_LABEL = 'Combine all selected audio into one transcription';

function stubEl(): any {
	return { empty: vi.fn(), createEl: vi.fn(() => stubEl()), createDiv: vi.fn(() => stubEl()) };
}

function audioEmbeds(n: number) {
	return Array.from({ length: n }, (_, i) => ({
		fileName: `clip${i}.mp3`,
		file: new TFile(`clip${i}.mp3`),
		line: i,
	}));
}

function openModal(n: number, ffmpeg: boolean) {
	const callbacks = {
		onTranscribeAudio: vi.fn().mockResolvedValue(undefined),
		onTranscribeVideo: vi.fn().mockResolvedValue(undefined),
		onExtractImages: vi.fn().mockResolvedValue(undefined),
	};
	const modal = new NoteMediaModal({} as any, audioEmbeds(n) as any, [], [], callbacks, ffmpeg);
	(modal as any).contentEl = stubEl();
	modal.onOpen();
	return modal;
}

describe('NoteMediaModal combine toggle gating (#214)', () => {
	beforeEach(() => {
		settingNames.length = 0;
	});

	it('shows the combine toggle with 2+ audio files and ffmpeg available', () => {
		openModal(2, true);
		expect(settingNames).toContain(COMBINE_LABEL);
	});

	it('hides the combine toggle with fewer than 2 audio files', () => {
		openModal(1, true);
		expect(settingNames).not.toContain(COMBINE_LABEL);
	});

	it('shows the combine toggle without ffmpeg (merges transcribed text instead)', () => {
		openModal(3, false);
		expect(settingNames).toContain(COMBINE_LABEL);
	});
});
