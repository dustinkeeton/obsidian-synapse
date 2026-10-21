import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from 'obsidian';
import type { ScanScope } from './scan-scope';

const mockConstructed: Array<{ app: unknown; onChoose: (scope: ScanScope) => void }> = [];
const mockOpen = vi.fn();

vi.mock('./scan-folder-picker-modal', () => ({
	ScanFolderPickerModal: class {
		constructor(public app: unknown, public onChoose: (scope: ScanScope) => void) {
			mockConstructed.push({ app, onChoose });
		}
		open = mockOpen;
	},
}));

import { openScanFolderPicker } from './open-scan-folder-picker';

const mockApp = {} as unknown as App;

describe('openScanFolderPicker', () => {
	beforeEach(() => {
		mockConstructed.length = 0;
		mockOpen.mockClear();
	});

	it('constructs a ScanFolderPickerModal with the given app and opens it', () => {
		openScanFolderPicker(mockApp, vi.fn());

		expect(mockConstructed).toHaveLength(1);
		expect(mockConstructed[0].app).toBe(mockApp);
		expect(mockOpen).toHaveBeenCalledTimes(1);
	});

	it('forwards the chosen scope unchanged', () => {
		const onChoose = vi.fn();
		openScanFolderPicker(mockApp, onChoose);

		mockConstructed[0].onChoose({ folder: undefined, recursive: false });

		expect(onChoose).toHaveBeenCalledWith({ folder: undefined, recursive: false });
	});
});
