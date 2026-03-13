import { Plugin } from 'obsidian';
import { AutoNotesSettings, DEFAULT_SETTINGS } from './settings';
import { AutoNotesSettingTab } from './settings-tab';
import { ElaborationModule } from './elaboration';
import { AudioModule } from './audio';
import { VideoModule } from './video';
import { NotificationManager } from './shared';

export default class AutoNotesPlugin extends Plugin {
	settings!: AutoNotesSettings;
	notifications!: NotificationManager;

	private elaboration!: ElaborationModule;
	private audio!: AudioModule;
	private video!: VideoModule;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new AutoNotesSettingTab(this.app, this));

		// Centralized notification manager
		this.notifications = new NotificationManager();
		this.notifications.setStatusBarEl(this.addStatusBarItem());

		const getSettings = () => this.settings;

		// Initialize modules (Audio before Video since Video depends on Audio)
		this.elaboration = new ElaborationModule(this, getSettings, this.notifications);
		this.audio = new AudioModule(this, getSettings, this.notifications);
		this.video = new VideoModule(this, getSettings, this.audio, this.notifications);

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

		// Ribbon icons — delegate to module methods
		this.addRibbonIcon('sparkles', 'Review elaboration proposals', () => {
			this.elaboration.activateProposalView();
		});

		this.addRibbonIcon('mic', 'Transcribe audio', () => {
			this.audio.openTranscriptionModal();
		});
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
