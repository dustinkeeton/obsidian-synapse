import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';

export class AudioTranscriptionModal extends Modal {
	private selectedFile: TFile | null = null;
	private onTranscribe: (file: TFile) => Promise<void>;

	constructor(
		app: App,
		private getSettings: () => AutoNotesSettings,
		onTranscribe: (file: TFile) => Promise<void>
	) {
		super(app);
		this.onTranscribe = onTranscribe;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Transcribe Audio' });

		// File selector
		const audioFiles = this.app.vault
			.getFiles()
			.filter((f) =>
				/\.(mp3|wav|m4a|ogg|flac|webm|aac)$/i.test(f.extension)
			);

		new Setting(contentEl)
			.setName('Audio file')
			.setDesc('Select an audio file from your vault')
			.addDropdown((dropdown) => {
				dropdown.addOption('', 'Select a file...');
				for (const file of audioFiles) {
					dropdown.addOption(file.path, file.path);
				}
				dropdown.onChange((value) => {
					this.selectedFile =
						this.app.vault.getAbstractFileByPath(value) as TFile | null;
				});
			});

		// Post-processing info
		const settings = this.getSettings().audio.postProcessing;
		const ppStatus = settings.enabled
			? 'Enabled (configure in settings)'
			: 'Disabled';
		new Setting(contentEl)
			.setName('Post-processing')
			.setDesc(ppStatus);

		// Transcribe button
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Transcribe')
				.setCta()
				.onClick(async () => {
					if (!this.selectedFile) {
						new Notice('Please select an audio file');
						return;
					}
					this.close();
					await this.onTranscribe(this.selectedFile);
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
