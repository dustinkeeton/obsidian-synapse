import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFolder, type App } from 'obsidian';

// Capture how openScanFolderPicker constructs the modal and whether it opens it.
// `mock`-prefixed names are referenced lazily inside the (hoisted) vi.mock
// factory — matching the codebase convention (see mockFindAudioEmbeds elsewhere).
const mockConstructed: Array<{
	app: unknown;
	onChoose: (folder: TFolder) => void;
	defaultPath: unknown;
}> = [];
const mockOpen = vi.fn();

vi.mock('./folder-picker-modal', () => ({
	FolderPickerModal: class {
		constructor(
			public app: unknown,
			public onChoose: (folder: TFolder) => void,
			public defaultPath?: string,
		) {
			mockConstructed.push({ app, onChoose, defaultPath });
		}
		open = mockOpen;
	},
}));

import { openScanFolderPicker } from './open-scan-folder-picker';

function makeFolder(path: string, root: boolean): TFolder {
	const f = new TFolder();
	f.path = path;
	f.name = path.split('/').pop() || '';
	f.children = [];
	f.isRoot = () => root;
	return f;
}

const mockApp = {} as unknown as App;

describe('openScanFolderPicker', () => {
	beforeEach(() => {
		mockConstructed.length = 0;
		mockOpen.mockClear();
	});

	it('constructs a FolderPickerModal with the given app and opens it', () => {
		openScanFolderPicker(mockApp, vi.fn());

		expect(mockConstructed).toHaveLength(1);
		expect(mockConstructed[0].app).toBe(mockApp);
		expect(mockOpen).toHaveBeenCalledTimes(1);
	});

	it('passes no defaultPath so the picker opens root-first', () => {
		openScanFolderPicker(mockApp, vi.fn());

		expect(mockConstructed[0].defaultPath).toBeUndefined();
	});

	it('maps the vault root folder to undefined', () => {
		const onChoose = vi.fn();
		openScanFolderPicker(mockApp, onChoose);

		mockConstructed[0].onChoose(makeFolder('/', true));

		expect(onChoose).toHaveBeenCalledWith(undefined);
	});

	it('maps a non-root folder to its path', () => {
		const onChoose = vi.fn();
		openScanFolderPicker(mockApp, onChoose);

		mockConstructed[0].onChoose(makeFolder('projects', false));

		expect(onChoose).toHaveBeenCalledWith('projects');
	});
});
