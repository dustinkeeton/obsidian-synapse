import type { DataAdapter } from 'obsidian';
import { redactError } from './redact';
import type { NotificationManager } from './notifications';

export const LEGACY_DATA_FOLDER = '.auto-notes';
export const DATA_FOLDER = '.synapse';

/**
 * One-time rename of the legacy `.auto-notes/` data folder to `.synapse/`.
 * Skips silently when the old folder is absent; warns and leaves both in place
 * when the new folder already exists.
 */
export async function migrateDataFolder(adapter: DataAdapter, notifications: NotificationManager): Promise<void> {
	try {
		const oldExists = await adapter.exists(LEGACY_DATA_FOLDER);
		if (!oldExists) return;

		const newExists = await adapter.exists(DATA_FOLDER);
		if (newExists) {
			console.warn(
				`[Synapse] Both ${LEGACY_DATA_FOLDER}/ and ${DATA_FOLDER}/ exist. ` +
				`Skipping automatic migration. Please merge manually.`
			);
			return;
		}

		await adapter.rename(LEGACY_DATA_FOLDER, DATA_FOLDER);
		notifications.success(
			`migrated data folder from ${LEGACY_DATA_FOLDER}/ to ${DATA_FOLDER}/`
		);
	} catch (error) {
		console.error('[Synapse] Failed to migrate data folder:', redactError(error));
		notifications.error(
			`failed to migrate ${LEGACY_DATA_FOLDER}/ to ${DATA_FOLDER}/ -- ` +
			`please rename it manually.`
		);
	}
}
