import { App, Modal, Notice, Setting } from 'obsidian';
import { AudioEmbed } from '../audio';
import { VideoUrlEmbed } from '../video';

export class NoteMediaModal extends Modal {
	private selectedAudio: Set<string>;
	private selectedVideo: Set<string>;

	constructor(
		app: App,
		private audioEmbeds: AudioEmbed[],
		private videoEmbeds: VideoUrlEmbed[],
		private callbacks: {
			onTranscribeAudio: (embeds: AudioEmbed[]) => Promise<void>;
			onTranscribeVideo: (embeds: VideoUrlEmbed[]) => Promise<void>;
		}
	) {
		super(app);
		this.selectedAudio = new Set(audioEmbeds.map(e => e.fileName));
		this.selectedVideo = new Set(videoEmbeds.map(e => e.url));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Transcribe Media from Note' });

		const audioCount = this.audioEmbeds.length;
		const videoCount = this.videoEmbeds.length;
		contentEl.createEl('p', {
			text: `Found ${audioCount} audio file(s) and ${videoCount} video URL(s).`,
		});

		// Select all / none
		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Select All').onClick(() => {
					this.selectedAudio = new Set(this.audioEmbeds.map(e => e.fileName));
					this.selectedVideo = new Set(this.videoEmbeds.map(e => e.url));
					this.renderCheckboxes(audioListEl, videoListEl);
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Select None').onClick(() => {
					this.selectedAudio.clear();
					this.selectedVideo.clear();
					this.renderCheckboxes(audioListEl, videoListEl);
				});
			});

		const audioListEl = contentEl.createDiv({ cls: 'synapse-audio-list' });
		const videoListEl = contentEl.createDiv({ cls: 'synapse-video-list' });
		this.renderCheckboxes(audioListEl, videoListEl);

		// Transcribe button
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Transcribe Selected')
				.setCta()
				.onClick(async () => {
					const chosenAudio = this.audioEmbeds.filter(e => this.selectedAudio.has(e.fileName));
					const chosenVideo = this.videoEmbeds.filter(e => this.selectedVideo.has(e.url));

					if (chosenAudio.length === 0 && chosenVideo.length === 0) {
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
				});
		});
	}

	private renderCheckboxes(audioContainer: HTMLElement, videoContainer: HTMLElement): void {
		audioContainer.empty();
		videoContainer.empty();

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
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
