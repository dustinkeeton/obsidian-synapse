import type { App } from 'obsidian';
import { ScanFolderPickerModal } from './scan-folder-picker-modal';
import type { ScanScope } from './scan-scope';

/**
 * Unified scan folder picker. Opens root-first so Enter-on-open scans the whole
 * vault (#416); the next row (or Shift+Enter on any folder) scans top level only (#589).
 */
export function openScanFolderPicker(
	app: App,
	onChoose: (scope: ScanScope) => void,
): void {
	new ScanFolderPickerModal(app, onChoose).open();
}
