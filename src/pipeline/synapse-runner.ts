import type { NotificationManager } from '../shared';
import type { SynapseSettings } from '../settings';
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
			return section.enabled;
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
}
