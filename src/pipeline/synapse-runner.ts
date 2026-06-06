import type { TFile } from 'obsidian';
import type { NotificationManager } from '../shared';
import type { SynapseSettings } from '../settings';
import { isPipelineKeyInFlow } from '../commands';
import { SYNAPSE_PIPELINE, PipelineModuleMap } from './types';

export class SynapseRunner {
	constructor(
		private modules: PipelineModuleMap,
		private getSettings: () => SynapseSettings,
		private notifications: NotificationManager,
	) {}

	async fire(folderPath?: string): Promise<void> {
		const settings = this.getSettings();
		const activePhases = SYNAPSE_PIPELINE.filter(phase => {
			const section = settings[phase.key] as { enabled: boolean };
			return section.enabled && isPipelineKeyInFlow(phase.key, 'fire-synapse');
		});

		if (activePhases.length === 0) {
			this.notifications.info('No features are enabled');
			return;
		}

		const op = this.notifications.startOperation(
			`Fire Synapse (0/${activePhases.length})`,
			'synapse-fire',
		);

		let completed = 0;
		for (const phase of activePhases) {
			if (op.cancelled) break;

			completed++;
			op.progress(
				completed,
				activePhases.length,
				`Phase ${completed}/${activePhases.length}: ${phase.label}`,
			);

			try {
				await this.modules[phase.key](folderPath, true);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				console.warn(`[Synapse] Phase ${phase.label} failed: ${msg}`);
			}
		}

		if (!op.cancelled) {
			op.finish(`Fire Synapse complete — ${completed} phases run`);
		}
	}

	/**
	 * Run the full pipeline against a single note instead of a folder.
	 *
	 * Mirrors {@link fire} exactly — same active-phase filtering
	 * (enabled + `isPipelineKeyInFlow`) and the same per-phase progress /
	 * error isolation — but scopes every phase to one file by passing the
	 * note's parent folder plus the note itself as `onlyFile`. Each module's
	 * scan fn applies `onlyFile` as a one-line filter after enumerating the
	 * folder, so the note is processed exactly once by every active phase
	 * with no rescan of its siblings.
	 *
	 * Used by the intake monitor (#111) to process a freshly added note. The
	 * folder-scoped {@link fire} path is unaffected: it never passes
	 * `onlyFile`.
	 */
	async fireOnFile(file: TFile): Promise<void> {
		const settings = this.getSettings();
		const activePhases = SYNAPSE_PIPELINE.filter(phase => {
			const section = settings[phase.key] as { enabled: boolean };
			return section.enabled && isPipelineKeyInFlow(phase.key, 'fire-synapse');
		});

		if (activePhases.length === 0) {
			this.notifications.info('No features are enabled');
			return;
		}

		// Scope every phase to the note's own folder so getMarkdownFiles
		// returns a superset that includes it; onlyFile then narrows to it.
		const folderPath = file.parent && !file.parent.isRoot()
			? file.parent.path
			: undefined;

		const op = this.notifications.startOperation(
			`Fire Synapse on ${file.basename} (0/${activePhases.length})`,
			'synapse-fire-file',
		);

		let completed = 0;
		for (const phase of activePhases) {
			if (op.cancelled) break;

			completed++;
			op.progress(
				completed,
				activePhases.length,
				`Phase ${completed}/${activePhases.length}: ${phase.label}`,
			);

			try {
				await this.modules[phase.key](folderPath, true, file);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				console.warn(`[Synapse] Phase ${phase.label} failed: ${msg}`);
			}
		}

		if (!op.cancelled) {
			op.finish(`Fire Synapse complete — ${completed} phases run`);
		}
	}
}
