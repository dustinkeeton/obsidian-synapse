import { App, Modal, Notice, Setting } from 'obsidian';
import { AudioEmbed } from '../audio';
import { VideoUrlEmbed } from '../video';
import { ImageEmbed } from '../image';

export class NoteMediaModal extends Modal {
	private selectedAudio: Set<string>;
	private selectedVideo: Set<string>;
	private selectedImage: Set<string>;

	constructor(
		app: App,
		private audioEmbeds: AudioEmbed[],
		private videoEmbeds: VideoUrlEmbed[],
		private imageEmbeds: ImageEmbed[],
		private callbacks: {
			onTranscribeAudio: (embeds: AudioEmbed[]) => Promise<void>;
			onTranscribeVideo: (embeds: VideoUrlEmbed[]) => Promise<void>;
			onExtractImages: (embeds: ImageEmbed[]) => Promise<void>;
		}
	) {
		super(app);
		this.selectedAudio = new Set(audioEmbeds.map(e => e.fileName));
		this.selectedVideo = new Set(videoEmbeds.map(e => e.url));
		this.selectedImage = new Set(imageEmbeds.map(e => e.fileName));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Process Media from Note' });

		const audioCount = this.audioEmbeds.length;
		const videoCount = this.videoEmbeds.length;
		const imageCount = this.imageEmbeds.length;
		const parts: string[] = [];
		if (audioCount > 0) parts.push(`${audioCount} audio file(s)`);
		if (videoCount > 0) parts.push(`${videoCount} video URL(s)`);
		if (imageCount > 0) parts.push(`${imageCount} image(s)`);
		contentEl.createEl('p', {
			text: `Found ${parts.join(', ')}.`,
		});

		// Select all / none
		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Select All').onClick(() => {
					this.selectedAudio = new Set(this.audioEmbeds.map(e => e.fileName));
					this.selectedVideo = new Set(this.videoEmbeds.map(e => e.url));
					this.selectedImage = new Set(this.imageEmbeds.map(e => e.fileName));
					this.renderCheckboxes(audioListEl, videoListEl, imageListEl);
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Select None').onClick(() => {
					this.selectedAudio.clear();
					this.selectedVideo.clear();
					this.selectedImage.clear();
					this.renderCheckboxes(audioListEl, videoListEl, imageListEl);
				});
			});

		const audioListEl = contentEl.createDiv({ cls: 'synapse-audio-list' });
		const videoListEl = contentEl.createDiv({ cls: 'synapse-video-list' });
		const imageListEl = contentEl.createDiv({ cls: 'synapse-image-list' });
		this.renderCheckboxes(audioListEl, videoListEl, imageListEl);

		// Process button
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Process Selected')
				.setCta()
				.onClick(async () => {
					const chosenAudio = this.audioEmbeds.filter(e => this.selectedAudio.has(e.fileName));
					const chosenVideo = this.videoEmbeds.filter(e => this.selectedVideo.has(e.url));
					const chosenImage = this.imageEmbeds.filter(e => this.selectedImage.has(e.fileName));

					if (chosenAudio.length === 0 && chosenVideo.length === 0 && chosenImage.length === 0) {
						new Notice('Please select at least one item');
						return;
					}

					this.close();

					if (chosenAudio.length > 0) {
						await this.callbacks.onTranscribeAudio(chosenAudio);
					}
					if (chosenVideo.length > 0) {
						await this.callbacks.onTranscribeVideo(chosenVideo);
					}
					if (chosenImage.length > 0) {
						await this.callbacks.onExtractImages(chosenImage);
					}
				});
		});
	}

	private renderCheckboxes(
		audioContainer: HTMLElement,
		videoContainer: HTMLElement,
		imageContainer: HTMLElement
	): void {
		audioContainer.empty();
		videoContainer.empty();
		imageContainer.empty();

		if (this.audioEmbeds.length > 0) {
			audioContainer.createEl('h4', { text: 'Audio Files' });
			for (const embed of this.audioEmbeds) {
				new Setting(audioContainer)
					.setName(embed.fileName)
					.addToggle((toggle) => {
						toggle
							.setValue(this.selectedAudio.has(embed.fileName))
							.onChange((val) => {
								if (val) {
									this.selectedAudio.add(embed.fileName);
								} else {
									this.selectedAudio.delete(embed.fileName);
								}
							});
					});
			}
		}

		if (this.videoEmbeds.length > 0) {
			videoContainer.createEl('h4', { text: 'Video URLs' });
			for (const embed of this.videoEmbeds) {
				new Setting(videoContainer)
					.setName(`${embed.platform}: ${embed.url}`)
					.addToggle((toggle) => {
						toggle
							.setValue(this.selectedVideo.has(embed.url))
							.onChange((val) => {
								if (val) {
									this.selectedVideo.add(embed.url);
								} else {
									this.selectedVideo.delete(embed.url);
								}
							});
					});
			}
		}

		if (this.imageEmbeds.length > 0) {
			imageContainer.createEl('h4', { text: 'Images (OCR)' });
			for (const embed of this.imageEmbeds) {
				new Setting(imageContainer)
					.setName(embed.fileName)
					.addToggle((toggle) => {
						toggle
							.setValue(this.selectedImage.has(embed.fileName))
							.onChange((val) => {
								if (val) {
									this.selectedImage.add(embed.fileName);
								} else {
									this.selectedImage.delete(embed.fileName);
								}
							});
					});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
