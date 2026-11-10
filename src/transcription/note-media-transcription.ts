import type { App, TFile } from 'obsidian';
import { findAudioEmbeds, findVideoUrls, findImageEmbeds } from '../shared';
import type { AudioEmbed, VideoUrlEmbed, ImageEmbed } from '../shared';
import { NoteMediaModal } from './note-media-modal';
import type { NoteMediaTranscriptionDeps } from './types';

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
