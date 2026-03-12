import { Plugin } from 'obsidian';
import { AutoNotesSettings, DEFAULT_SETTINGS } from './settings';
import { AutoNotesSettingTab } from './settings-tab';
import { ElaborationModule } from './elaboration';
import { AudioModule } from './audio';
import { VideoModule } from './video';
import { PROPOSAL_VIEW_TYPE } from './elaboration/proposal-view';
import { AudioTranscriptionModal } from './audio/transcription-modal';

export default class AutoNotesPlugin extends Plugin {
	settings!: AutoNotesSettings;

	private elaboration!: ElaborationModule;
	private audio!: AudioModule;
	private video!: VideoModule;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new AutoNotesSettingTab(this.app, this));

		const getSettings = () => this.settings;

		// Initialize modules (Audio before Video since Video depends on Audio)
		this.elaboration = new ElaborationModule(this, getSettings);
		this.audio = new AudioModule(this, getSettings);
		this.video = new VideoModule(this, getSettings, this.audio);

		// Load enabled modules
		if (this.settings.elaboration.enabled) {
			await this.elaboration.onload();
		}
		if (this.settings.audio.enabled) {
			await this.audio.onload();
		}
		if (this.settings.video.enabled) {
			await this.video.onload();
		}

		// Ribbon icons
		this.addRibbonIcon('sparkles', 'Review elaboration proposals', () => {
			this.activateProposalView();
		});

		this.addRibbonIcon('mic', 'Transcribe audio', () => {
			new AudioTranscriptionModal(
				this.app,
				getSettings,
				async (file) => {
					const data = await this.app.vault.readBinary(file);
					const result = await this.audio.transcribe(data, file.name);
					await this.audio.saveTranscription(result);
				}
			).open();
		});

		// Status bar
		this.addStatusBarItem().setText('Auto Notes: idle');
	}

	onunload(): void {
		this.elaboration?.onunload();
		this.audio?.onunload();
		this.video?.onunload();
	}

	async loadSettings(): Promise<void> {
		this.settings = this.deepMerge(
			DEFAULT_SETTINGS,
			(await this.loadData()) || {}
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async activateProposalView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(PROPOSAL_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({
				type: PROPOSAL_VIEW_TYPE,
				active: true,
			});
		}
		workspace.revealLeaf(leaf);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private deepMerge<T>(target: T, source: any): T {
		const output: any = { ...target };
		for (const key of Object.keys(source)) {
			if (
				source[key] &&
				typeof source[key] === 'object' &&
				!Array.isArray(source[key]) &&
				key in (target as any) &&
				typeof (target as any)[key] === 'object' &&
				!Array.isArray((target as any)[key])
			) {
				output[key] = this.deepMerge(
					(target as any)[key],
					source[key]
				);
			} else {
				output[key] = source[key];
			}
		}
		return output as T;
	}
}
