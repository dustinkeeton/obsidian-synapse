import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Notice, requestUrl, type StubEl } from '../__mocks__/obsidian';
import { DEFAULT_SETTINGS } from '../settings';
import type { SynapseSettings } from '../settings';
import { NotificationManager } from './notifications';
import { UpdateChecker, isNewerVersion } from './update-checker';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Recursively locate the first <button> element in a stub-element tree. */
function findButton(el: StubEl): StubEl | null {
	for (const child of el.children as unknown as StubEl[]) {
		if (child.tagName === 'BUTTON') return child;
		const nested = findButton(child);
		if (nested) return nested;
	}
	return null;
}

function notices(): Notice[] {
	return Notice.instances;
}
function lastNotice(): Notice {
	return notices().at(-1)!;
}

/**
 * Collect a notice's full text. Action notices (#365) put the message in a child
 * div rather than on `noticeEl.textContent`, so recurse through the stub tree.
 */
function noticeText(notice: Notice): string {
	const collect = (el: StubEl): string => {
		let text = el.textContent ?? '';
		for (const child of el.children as unknown as StubEl[]) text += collect(child);
		return text;
	};
	return collect(notice.noticeEl);
}

/** Build a full settings object with the `updates` group overridden. */
function settingsWith(updates: Partial<SynapseSettings['updates']>): SynapseSettings {
	return {
		...structuredClone(DEFAULT_SETTINGS),
		updates: { enableUpdateNotifications: true, ...updates },
	};
}

interface Harness {
	checker: UpdateChecker;
	settings: SynapseSettings;
	saveSettings: ReturnType<typeof vi.fn>;
	app: { setting?: { open: ReturnType<typeof vi.fn>; openTabById: ReturnType<typeof vi.fn> } };
}

function makeChecker(opts?: {
	currentVersion?: string;
	updates?: Partial<SynapseSettings['updates']>;
	app?: unknown;
}): Harness {
	const settings = settingsWith(opts?.updates ?? {});
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const app = (opts?.app ?? { setting: { open: vi.fn(), openTabById: vi.fn() } }) as Harness['app'];
	const checker = new UpdateChecker({
		currentVersion: opts?.currentVersion ?? '1.0.6',
		app: app as never,
		notifications: new NotificationManager(),
		getSettings: () => settings,
		saveSettings,
	});
	return { checker, settings, saveSettings, app };
}

/** Stub the next requestUrl resolution as a GitHub "latest release" response. */
function mockRelease(tag: string | null, status = 200): void {
	vi.mocked(requestUrl).mockResolvedValue({
		status,
		json: tag === null ? {} : { tag_name: tag },
		text: '',
		headers: {},
	});
}

describe('isNewerVersion', () => {
	it('returns true when latest is strictly newer (patch/minor/major)', () => {
		expect(isNewerVersion('1.0.7', '1.0.6')).toBe(true);
		expect(isNewerVersion('1.1.0', '1.0.6')).toBe(true);
		expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
	});

	it('returns false when the versions are equal', () => {
		expect(isNewerVersion('1.0.6', '1.0.6')).toBe(false);
	});

	it('returns false when latest is older', () => {
		expect(isNewerVersion('1.0.5', '1.0.6')).toBe(false);
		expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false);
	});

	it('ignores a leading v on either side', () => {
		expect(isNewerVersion('v1.0.7', '1.0.6')).toBe(true);
		expect(isNewerVersion('1.0.7', 'v1.0.6')).toBe(true);
		expect(isNewerVersion('v1.0.6', 'v1.0.6')).toBe(false);
	});

	it('treats a missing trailing component as zero', () => {
		expect(isNewerVersion('1.1', '1.0.9')).toBe(true);
		expect(isNewerVersion('1.0', '1.0.0')).toBe(false);
	});

	it('returns false (fail safe) for malformed input', () => {
		expect(isNewerVersion('latest', '1.0.6')).toBe(false);
		expect(isNewerVersion('1.0.7', 'not-a-version')).toBe(false);
		expect(isNewerVersion('', '1.0.6')).toBe(false);
		expect(isNewerVersion('1.x', '1.0.6')).toBe(false);
		expect(isNewerVersion('1.0.0.1', '1.0.0')).toBe(false);
	});
});

describe('UpdateChecker.maybeCheck', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		notices().length = 0;
		vi.mocked(requestUrl).mockReset();
		mockRelease('1.0.6'); // safe default: equal → no notice
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('shows exactly one sticky notice when a newer release exists', async () => {
		mockRelease('v1.0.7');
		const { checker, settings } = makeChecker({ currentVersion: '1.0.6' });

		await checker.maybeCheck(DAY_MS * 10);

		expect(notices()).toHaveLength(1);
		expect(noticeText(lastNotice())).toContain('v1.0.7 is available');
		// Sticky: persists until clicked/dismissed (duration 0).
		expect(lastNotice().duration).toBe(0);
		// The shown version is recorded so it never nags twice.
		expect(settings.updates.dismissedUpdateVersion).toBe('1.0.7');
	});

	it('records the attempt timestamp and persists it', async () => {
		mockRelease('1.0.7');
		const { checker, settings, saveSettings } = makeChecker();

		await checker.maybeCheck(DAY_MS * 10);

		expect(settings.updates.lastUpdateCheck).toBe(DAY_MS * 10);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('shows no notice when already on the latest version', async () => {
		mockRelease('1.0.6');
		const { checker } = makeChecker({ currentVersion: '1.0.6' });

		await checker.maybeCheck(DAY_MS * 10);

		expect(notices()).toHaveLength(0);
	});

	it('shows no notice when the latest release is older', async () => {
		mockRelease('1.0.5');
		const { checker } = makeChecker({ currentVersion: '1.0.6' });

		await checker.maybeCheck(DAY_MS * 10);

		expect(notices()).toHaveLength(0);
	});

	it('shows no notice when this version was already shown', async () => {
		mockRelease('1.0.7');
		const { checker } = makeChecker({
			currentVersion: '1.0.6',
			updates: { dismissedUpdateVersion: '1.0.7' },
		});

		await checker.maybeCheck(DAY_MS * 10);

		expect(notices()).toHaveLength(0);
	});

	it('does not check when notifications are disabled', async () => {
		mockRelease('1.0.7');
		const { checker, saveSettings } = makeChecker({
			updates: { enableUpdateNotifications: false },
		});

		await checker.maybeCheck(DAY_MS * 10);

		expect(requestUrl).not.toHaveBeenCalled();
		expect(saveSettings).not.toHaveBeenCalled();
		expect(notices()).toHaveLength(0);
	});

	it('does not check again within the 24h window', async () => {
		mockRelease('1.0.7');
		const { checker, saveSettings } = makeChecker({
			updates: { lastUpdateCheck: 1000 },
		});

		await checker.maybeCheck(1000 + DAY_MS - 1);

		expect(requestUrl).not.toHaveBeenCalled();
		expect(saveSettings).not.toHaveBeenCalled();
		expect(notices()).toHaveLength(0);
	});

	it('checks again once 24h have elapsed', async () => {
		mockRelease('1.0.7');
		const { checker } = makeChecker({
			currentVersion: '1.0.6',
			updates: { lastUpdateCheck: 1000 },
		});

		await checker.maybeCheck(1000 + DAY_MS);

		expect(requestUrl).toHaveBeenCalledTimes(1);
		expect(notices()).toHaveLength(1);
	});

	it('fails silently on a network error (no notice, no throw)', async () => {
		vi.mocked(requestUrl).mockRejectedValue(new Error('boom'));
		const { checker } = makeChecker();

		await expect(checker.maybeCheck(DAY_MS * 10)).resolves.toBeUndefined();

		expect(notices()).toHaveLength(0);
		expect(warnSpy).toHaveBeenCalled();
	});

	it('fails silently on a non-200 response', async () => {
		mockRelease('1.0.7', 403);
		const { checker } = makeChecker({ currentVersion: '1.0.6' });

		await checker.maybeCheck(DAY_MS * 10);

		expect(notices()).toHaveLength(0);
		expect(warnSpy).toHaveBeenCalled();
	});

	it('fails silently when the response has no tag_name', async () => {
		mockRelease(null, 200);
		const { checker } = makeChecker();

		await checker.maybeCheck(DAY_MS * 10);

		expect(notices()).toHaveLength(0);
		expect(warnSpy).toHaveBeenCalled();
	});

	it('clicking Update opens the Community plugins settings tab', async () => {
		mockRelease('1.0.7');
		const { checker, app } = makeChecker({ currentVersion: '1.0.6' });

		await checker.maybeCheck(DAY_MS * 10);

		const button = findButton(lastNotice().noticeEl);
		expect(button?.textContent).toBe('Update');
		button?.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });

		expect(app.setting?.open).toHaveBeenCalledTimes(1);
		expect(app.setting?.openTabById).toHaveBeenCalledWith('community-plugins');
	});

	it('falls back to a guidance notice when app.setting is unavailable', async () => {
		mockRelease('1.0.7');
		// app without the undocumented `setting` API.
		const { checker } = makeChecker({ currentVersion: '1.0.6', app: {} });

		await checker.maybeCheck(DAY_MS * 10);

		const button = findButton(lastNotice().noticeEl);
		expect(() =>
			button?.dispatchEvent({ type: 'click', stopPropagation: vi.fn() }),
		).not.toThrow();

		// The click surfaced a plain guidance notice instead of throwing.
		expect(lastNotice().noticeEl.textContent).toContain('Community plugins');
	});
});
