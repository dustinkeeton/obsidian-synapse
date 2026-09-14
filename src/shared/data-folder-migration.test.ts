import { describe, it, expect, vi } from 'vitest';
import { migrateDataFolder, LEGACY_DATA_FOLDER, DATA_FOLDER } from './data-folder-migration';
import type { DataAdapter } from 'obsidian';
import type { NotificationManager } from './notifications';

function makeAdapter(existing: string[]) {
	return {
		exists: vi.fn(async (path: string) => existing.includes(path)),
		rename: vi.fn().mockResolvedValue(undefined),
	};
}

function makeNotifications() {
	return { success: vi.fn(), error: vi.fn() };
}

describe('migrateDataFolder', () => {
	it('does nothing when the legacy folder is absent', async () => {
		const adapter = makeAdapter([DATA_FOLDER]);
		const notifications = makeNotifications();
		await migrateDataFolder(adapter as unknown as DataAdapter, notifications as unknown as NotificationManager);
		expect(adapter.rename).not.toHaveBeenCalled();
		expect(notifications.success).not.toHaveBeenCalled();
	});

	it('renames the legacy folder and reports success', async () => {
		const adapter = makeAdapter([LEGACY_DATA_FOLDER]);
		const notifications = makeNotifications();
		await migrateDataFolder(adapter as unknown as DataAdapter, notifications as unknown as NotificationManager);
		expect(adapter.rename).toHaveBeenCalledWith(LEGACY_DATA_FOLDER, DATA_FOLDER);
		expect(notifications.success).toHaveBeenCalledTimes(1);
	});

	it('leaves both folders alone when the new one already exists', async () => {
		const adapter = makeAdapter([LEGACY_DATA_FOLDER, DATA_FOLDER]);
		const notifications = makeNotifications();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await migrateDataFolder(adapter as unknown as DataAdapter, notifications as unknown as NotificationManager);
		expect(adapter.rename).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(notifications.error).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it('surfaces a rename failure as a persistent error toast', async () => {
		const adapter = makeAdapter([LEGACY_DATA_FOLDER]);
		adapter.rename.mockRejectedValue(new Error('EACCES'));
		const notifications = makeNotifications();
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		await migrateDataFolder(adapter as unknown as DataAdapter, notifications as unknown as NotificationManager);
		expect(notifications.error).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledTimes(1);
		error.mockRestore();
	});
});
