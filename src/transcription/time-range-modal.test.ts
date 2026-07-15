import { describe, it, expect, vi } from 'vitest';
import { TimeRangeModal } from './time-range-modal';
import type { TimeRangeChoice } from './time-range-modal';
import { createEl, type StubEl } from '../__mocks__/obsidian';
import type { NotificationManager } from '../shared';

/**
 * Drives the modal through its resolution semantics: a blocking follow-up
 * decision must distinguish "full file" from "dismissed" — dismissal does
 * nothing rather than silently transcribing the whole file.
 */

function makeModal(duration?: number) {
	const notifications = { info: vi.fn() };
	const modal = new TimeRangeModal(
		{} as never,
		{ title: 'A Long Video', duration },
		notifications as unknown as NotificationManager
	);
	const contentEl = createEl();
	(modal as unknown as { contentEl: StubEl }).contentEl = contentEl;

	const choice = modal.openAndChoose();
	modal.onOpen();

	const buttons = contentEl.findAll('button') as StubEl[];
	return {
		modal,
		contentEl,
		notifications,
		choice,
		fullBtn: buttons[0],
		selectionBtn: buttons[1],
	};
}

async function settled(p: Promise<TimeRangeChoice>): Promise<TimeRangeChoice> {
	return p;
}

describe('TimeRangeModal (known duration)', () => {
	it('labels the buttons full-file-quiet, selection-primary', () => {
		const { fullBtn, selectionBtn } = makeModal(600);
		expect(fullBtn.textContent).toBe('Full file');
		expect(selectionBtn.textContent).toBe('Transcribe selection');
		expect(selectionBtn.classList.contains('mod-cta')).toBe(true);
	});

	it('resolves full when "Full file" is clicked', async () => {
		const { fullBtn, choice } = makeModal(600);
		fullBtn.dispatchEvent({ type: 'click' });
		expect(await settled(choice)).toEqual({ kind: 'full' });
	});

	it('resolves full when the selection was never narrowed', async () => {
		const { selectionBtn, choice } = makeModal(600);
		selectionBtn.dispatchEvent({ type: 'click' });
		expect(await settled(choice)).toEqual({ kind: 'full' });
	});

	it('resolves the narrowed selection', async () => {
		const { contentEl, selectionBtn, choice } = makeModal(600);
		const [startInput] = contentEl.findAll('input') as StubEl[];
		startInput.value = '60';
		startInput.dispatchEvent({ type: 'input' });
		selectionBtn.dispatchEvent({ type: 'click' });
		expect(await settled(choice)).toEqual({
			kind: 'selection',
			range: { startSeconds: 60, endSeconds: 600 },
		});
	});

	it('resolves cancelled on dismiss (Escape / click-away)', async () => {
		const { modal, choice } = makeModal(600);
		modal.onClose();
		expect(await settled(choice)).toEqual({ kind: 'cancelled' });
	});

	it('settles exactly once (button then dismiss)', async () => {
		const { modal, fullBtn, choice } = makeModal(600);
		fullBtn.dispatchEvent({ type: 'click' });
		modal.onClose();
		expect(await settled(choice)).toEqual({ kind: 'full' });
	});
});

describe('TimeRangeModal (unknown duration — manual inputs)', () => {
	it('rejects an empty submission and stays open', async () => {
		const { selectionBtn, notifications, modal, choice } = makeModal(undefined);
		selectionBtn.dispatchEvent({ type: 'click' });
		expect(notifications.info).toHaveBeenCalledWith('Both start and end times are required');
		// Still pending: dismissing afterwards resolves cancelled, not a range.
		modal.onClose();
		expect(await settled(choice)).toEqual({ kind: 'cancelled' });
	});

	it('validates and resolves a typed range', async () => {
		const { contentEl, selectionBtn, choice } = makeModal(undefined);
		const [startInput, endInput] = contentEl.findAll('input') as StubEl[];
		startInput.value = '00:30';
		endInput.value = '02:00';
		selectionBtn.dispatchEvent({ type: 'click' });
		expect(await settled(choice)).toEqual({
			kind: 'selection',
			range: { startSeconds: 30, endSeconds: 120 },
		});
	});

	it('surfaces validation errors without settling', async () => {
		const { contentEl, selectionBtn, notifications, modal, choice } = makeModal(undefined);
		const [startInput, endInput] = contentEl.findAll('input') as StubEl[];
		startInput.value = '05:00';
		endInput.value = '01:00';
		selectionBtn.dispatchEvent({ type: 'click' });
		expect(notifications.info).toHaveBeenCalled();
		modal.onClose();
		expect(await settled(choice)).toEqual({ kind: 'cancelled' });
	});

	it('still offers the full file', async () => {
		const { fullBtn, choice } = makeModal(undefined);
		fullBtn.dispatchEvent({ type: 'click' });
		expect(await settled(choice)).toEqual({ kind: 'full' });
	});
});
