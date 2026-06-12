import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TFile } from '../__mocks__/obsidian';
import { VideoModule } from './index';
import type { VideoMetadata } from './types';

/**
 * Focused coverage for VideoModule.downloadVideoToVault — the Vault-API
 * migration (#280). The method is private, so we reach it via bracket access.
 * Real fs is used for the temp-file round-trip (mirrors the audio combine
 * tests) so the pool-backed-Buffer slice path is genuinely exercised.
 */

const VIDEO_BYTES = Buffer.from('fake-mp4-payload-bytes');

interface VaultStub {
	createBinary: ReturnType<typeof vi.fn>;
	getAbstractFileByPath: ReturnType<typeof vi.fn>;
	createFolder: ReturnType<typeof vi.fn>;
	adapter: { writeBinary: ReturnType<typeof vi.fn> };
}

function makeVault(
	getAbstractFileByPath = vi.fn().mockReturnValue(null)
): VaultStub {
	return {
		createBinary: vi.fn().mockResolvedValue(new TFile()),
		getAbstractFileByPath,
		createFolder: vi.fn().mockResolvedValue(undefined),
		adapter: { writeBinary: vi.fn().mockResolvedValue(undefined) },
	};
}

function makeModule(downloadFolder: string, vault: VaultStub, tempPath: string) {
	const getSettings = () =>
		({
			video: {
				enabled: true,
				downloadFolder,
				tempFolder: '.synapse/temp',
				ffmpegPath: 'ffmpeg',
			},
		}) as never;
	const plugin = { app: { vault } } as never;
	const mod = new VideoModule(
		plugin,
		getSettings,
		{} as never,
		{} as never,
		{} as never,
		{} as never
	);
	// Replace the real extractor with a stub that "downloads" to our temp file.
	(mod as unknown as { extractor: { downloadVideo: ReturnType<typeof vi.fn> } }).extractor = {
		downloadVideo: vi.fn().mockResolvedValue(tempPath),
	};
	return mod;
}

function callDownload(mod: VideoModule, metadata: VideoMetadata): Promise<string> {
	return (
		mod as unknown as {
			downloadVideoToVault: (url: string, m: VideoMetadata) => Promise<string>;
		}
	).downloadVideoToVault('https://example.com/v', metadata);
}

describe('VideoModule.downloadVideoToVault', () => {
	let tempPath: string;
	let counter = 0;

	beforeEach(async () => {
		tempPath = path.join(os.tmpdir(), `synapse-video-test-${counter++}.mp4`);
		await fs.promises.writeFile(tempPath, VIDEO_BYTES);
	});

	afterEach(async () => {
		try {
			await fs.promises.unlink(tempPath);
		} catch {
			/* already cleaned up by the unit under test */
		}
	});

	it('writes the video via vault.createBinary, not the adapter API', async () => {
		const vault = makeVault();
		const mod = makeModule('Media', vault, tempPath);

		const result = await callDownload(mod, { title: 'My Test Video' });

		expect(vault.createBinary).toHaveBeenCalledTimes(1);
		expect(vault.adapter.writeBinary).not.toHaveBeenCalled();

		const [writtenPath, writtenData] = vault.createBinary.mock.calls[0];
		expect(writtenPath).toMatch(/^Media\/\d{4}-\d{2}-\d{2}-My Test Video\.mp4$/);
		expect(result).toBe(writtenPath);

		// Exact-bytes assertion: proves the pool-backed-Buffer slice is correct.
		expect(writtenData).toBeInstanceOf(ArrayBuffer);
		expect(Buffer.from(writtenData as ArrayBuffer).equals(VIDEO_BYTES)).toBe(true);
	});

	it('cleans up the temp download file after writing', async () => {
		const vault = makeVault();
		const mod = makeModule('Media', vault, tempPath);

		await callDownload(mod, { title: 'Cleanup Video' });

		expect(fs.existsSync(tempPath)).toBe(false);
	});

	it('normalizes the joined download-folder path (no double slashes)', async () => {
		const vault = makeVault();
		const mod = makeModule('Media//Sub/', vault, tempPath);

		const result = await callDownload(mod, { title: 'Nested Video' });

		expect(result).not.toContain('//');
		expect(result).toMatch(/^Media\/Sub\/\d{4}-\d{2}-\d{2}-Nested Video\.mp4$/);
		expect(vault.createBinary).toHaveBeenCalledWith(result, expect.any(ArrayBuffer));
	});

	it('suffixes the filename on collision instead of overwriting', async () => {
		// The un-suffixed name is taken; the "-1" name is free.
		const getAbstractFileByPath = vi.fn((p: string) =>
			p.endsWith('Dupe Video.mp4') ? new TFile(p) : null
		);
		const vault = makeVault(getAbstractFileByPath);
		const mod = makeModule('Media', vault, tempPath);

		const result = await callDownload(mod, { title: 'Dupe Video' });

		expect(result).toMatch(/^Media\/\d{4}-\d{2}-\d{2}-Dupe Video-1\.mp4$/);
		expect(vault.createBinary).toHaveBeenCalledWith(result, expect.any(ArrayBuffer));
	});

	it('increments the suffix until a free name is found', async () => {
		// Both the base name and "-1" are taken; "-2" is free.
		const getAbstractFileByPath = vi.fn((p: string) =>
			p.endsWith('Busy Video.mp4') || p.endsWith('Busy Video-1.mp4')
				? new TFile(p)
				: null
		);
		const vault = makeVault(getAbstractFileByPath);
		const mod = makeModule('Media', vault, tempPath);

		const result = await callDownload(mod, { title: 'Busy Video' });

		expect(result).toMatch(/^Media\/\d{4}-\d{2}-\d{2}-Busy Video-2\.mp4$/);
	});
});
