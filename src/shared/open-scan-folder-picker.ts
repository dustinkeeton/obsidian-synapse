import type { App } from 'obsidian';
import { FolderPickerModal } from './folder-picker-modal';

/**
 * Unified scan folder picker. Opens with an empty query, which FolderPickerModal
 * sorts root-first, so Enter-on-open scans the whole vault. `onChoose` receives
 * the chosen folder path, or `undefined` for the vault root.
 */
export function openScanFolderPicker(
	app: App,
	onChoose: (path: string | undefined) => void,
): void {
	new FolderPickerModal(app, (folder) => {
		onChoose(folder.isRoot() ? undefined : folder.path);
	}).open();
}
