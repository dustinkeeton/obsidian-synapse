import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { AssetWriter, attachmentFileName } from './asset-writer';
import { mockFile } from '../__test-utils__/mock-factories';
import type { MediaCandidate } from './types';

const candidate: MediaCandidate = {
	provider: 'openverse', title: 'Golden Gate Bridge at dusk', fileUrl: 'https://img.example.com/gg.jpeg?x=1',
	thumbnailUrl: '', pageUrl: '', license: 'CC BY', licenseUrl: '', attribution: 'x',
};

describe('attachmentFileName', () => {
	it('slugs the title and takes the extension from the MIME type first', () => {
		expect(attachmentFileName({ ...candidate, mimeType: 'image/png' })).toBe('golden-gate-bridge-at-dusk.png');
	});

	it('falls back to the URL extension, mapping jpeg to jpg', () => {
		expect(attachmentFileName(candidate)).toBe('golden-gate-bridge-at-dusk.jpg');
	});

	it('strips a file extension already in the title and never yields an empty slug', () => {
		expect(attachmentFileName({ ...candidate, title: 'Panda.JPG', mimeType: 'image/jpeg' })).toBe('panda.jpg');
		expect(attachmentFileName({ ...candidate, title: '!!!', mimeType: 'image/gif' })).toBe('illustration.gif');
	});
});

describe('AssetWriter.download', () => {
	let app: App;
	const note = mockFile('notes/a.md') as unknown as TFile;

	beforeEach(() => {
		vi.mocked(requestUrl).mockReset();
		app = {
			fileManager: { getAvailablePathForAttachment: vi.fn().mockResolvedValue('attachments/golden-gate-bridge-at-dusk.jpg') },
			vault: { createBinary: vi.fn().mockImplementation((path: string) => Promise.resolve(mockFile(path))) },
		} as unknown as App;
	});

	it('writes the response bytes into the attachment folder resolved for the note', async () => {
		const data = new Uint8Array([1, 2, 3]).buffer;
		vi.mocked(requestUrl).mockResolvedValue({ status: 200, arrayBuffer: data } as never);
		const file = await new AssetWriter(app).download(candidate, note);
		expect(vi.mocked(app.fileManager.getAvailablePathForAttachment)).toHaveBeenCalledWith('golden-gate-bridge-at-dusk.jpg', 'notes/a.md');
		expect(vi.mocked(app.vault.createBinary)).toHaveBeenCalledWith('attachments/golden-gate-bridge-at-dusk.jpg', data);
		expect(file.path).toBe('attachments/golden-gate-bridge-at-dusk.jpg');
	});

	it('throws on HTTP errors and empty bodies without writing', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 404, arrayBuffer: new ArrayBuffer(0) } as never);
		await expect(new AssetWriter(app).download(candidate, note)).rejects.toThrow('HTTP 404');
		vi.mocked(requestUrl).mockResolvedValue({ status: 200, arrayBuffer: new ArrayBuffer(0) } as never);
		await expect(new AssetWriter(app).download(candidate, note)).rejects.toThrow('no data');
		expect(vi.mocked(app.vault.createBinary)).not.toHaveBeenCalled();
	});

	it('rejects non-HTTP URLs before any request', async () => {
		await expect(new AssetWriter(app).download({ ...candidate, fileUrl: 'file:///etc/passwd' }, note)).rejects.toThrow();
		expect(requestUrl).not.toHaveBeenCalled();
	});
});
