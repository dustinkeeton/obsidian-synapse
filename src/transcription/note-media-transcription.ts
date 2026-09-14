import type { App, TFile } from 'obsidian';
import { findAudioEmbeds } from '../audio';
import type { AudioEmbed } from '../audio';
import { findVideoUrls } from '../video';
import type { VideoUrlEmbed } from '../video';
import { findImageEmbeds } from '../image';
import type { ImageEmbed } from '../image';
import type { NotificationManager } from '../shared';
import type { SynapseSettings } from '../settings';
import { NoteMediaModal } from './note-media-modal';

/** Wiring for {@link transcribeNoteMedia}, injected by main.ts. */
export interface NoteMediaTranscriptionDeps {
	app: App;
	getSettings: () => SynapseSettings;
	notifications: NotificationManager;
	isFfmpegAvailable: () => Promise<boolean>;
	onTranscribeAudio: (file: TFile, embeds: AudioEmbed[], combine: boolean) => Promise<void>;
	/** Absent on mobile: video embeds are then never scanned or offered. */
	onTranscribeVideo?: (file: TFile, embeds: VideoUrlEmbed[]) => Promise<void>;
	onExtractImages: (file: TFile, embeds: ImageEmbed[]) => Promise<void>;
}

/** Scan a note for audio/video/image embeds (per enabled feature) and open the note-media picker. */
export async function transcribeNoteMedia(deps: NoteMediaTranscriptionDeps, file: TFile): Promise<void> {
	const { app, notifications } = deps;
	const settings = deps.getSettings();
	const content = await app.vault.read(file);

	const audioEmbeds = settings.audio.enabled
		? findAudioEmbeds(content, file.path, app.metadataCache)
		: [];
	const videoEmbeds = settings.video.enabled && deps.onTranscribeVideo
		? findVideoUrls(content)
		: [];
	const imageEmbeds = settings.image.enabled
		? findImageEmbeds(content, file.path, app.metadataCache)
		: [];

	if (audioEmbeds.length === 0 && videoEmbeds.length === 0 && imageEmbeds.length === 0) {
		notifications.info('No media found in this note');
		return;
	}

	const ffmpegAvailable = await deps.isFfmpegAvailable();
	const onTranscribeVideo = deps.onTranscribeVideo;

	new NoteMediaModal(
		app,
		audioEmbeds,
		videoEmbeds,
		imageEmbeds,
		{
			onTranscribeAudio: (selected, combine) => deps.onTranscribeAudio(file, selected, combine),
			onTranscribeVideo: onTranscribeVideo
				? (selected) => onTranscribeVideo(file, selected)
				: async () => {},
			onExtractImages: (selected) => deps.onExtractImages(file, selected),
		},
		notifications,
		ffmpegAvailable
	).open();
}
