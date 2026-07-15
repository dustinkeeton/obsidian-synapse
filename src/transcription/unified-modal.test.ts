import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from '../__mocks__/obsidian';
import { UnifiedTranscriptionModal } from './unified-modal';
import { DEFAULT_SETTINGS } from '../settings';
import { makeSettings } from '../__test-utils__/mock-factories';
import type { NotificationManager } from '../shared';

/**
 * Minimal Modal contentEl stand-in: the mock Modal's contentEl createDiv is a
 * bare vi.fn(), but the URL section chains `.hide()`/`.setText()` on the
 * platform badge, so return a badge-shaped stub and record the calls.
 */
function makeContentEl() {
	const createDiv = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), setText: vi.fn() }));
	return { empty: vi.fn(), createEl: vi.fn(), createDiv };
}

function makeModal(enabledModules: { audio: boolean; video: boolean }) {
	const callbacks = {
		onTranscribeFile: vi.fn(() => Promise.resolve()),
		onTranscribeUrl: vi.fn(() => Promise.resolve()),
	};
	const app = { vault: { getFiles: () => [] } };
	const modal = new UnifiedTranscriptionModal(
		app as never,
		() => makeSettings(DEFAULT_SETTINGS),
		enabledModules,
		callbacks,
		{ info: vi.fn() } as unknown as NotificationManager
	);
	const contentEl = makeContentEl();
	(modal as unknown as { contentEl: unknown }).contentEl = contentEl;
	return { modal, callbacks, contentEl };
}

afterEach(() => {
	Platform.isDesktop = true;
	Platform.isMobile = false;
});

describe('UnifiedTranscriptionModal URL section (#184)', () => {
	it('renders the URL input on mobile when video is enabled', () => {
		Platform.isDesktop = false;
		Platform.isMobile = true;
		const { modal, contentEl } = makeModal({ audio: true, video: true });

		modal.onOpen();

		expect(contentEl.createDiv).toHaveBeenCalledWith({ cls: 'synapse-platform-badge' });
	});

	it('does not render the URL input when video is disabled', () => {
		const { modal, contentEl } = makeModal({ audio: true, video: false });

		modal.onOpen();

		expect(contentEl.createDiv).not.toHaveBeenCalledWith({ cls: 'synapse-platform-badge' });
	});

	it('dispatches a URL directly (no duration detection) on mobile', async () => {
		Platform.isDesktop = false;
		Platform.isMobile = true;
		const { modal, callbacks } = makeModal({ audio: false, video: true });
		const url = 'https://www.youtube.com/watch?v=abc123xyz00';
		(modal as unknown as { url: string }).url = url;

		await (modal as unknown as { handleTranscribe: () => Promise<void> }).handleTranscribe();

		expect(callbacks.onTranscribeUrl).toHaveBeenCalledWith(url);
	});
});
