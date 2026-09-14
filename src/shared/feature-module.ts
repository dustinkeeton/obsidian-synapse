import type { Plugin } from 'obsidian';
import type { SynapseSettings } from '../settings';
import type { CommandRegistrar } from '../commands';
import type { CheckpointManager } from './checkpoint-manager';
import type { NotificationManager } from './notifications';
import type { NoteOperationQueue } from './note-operation-queue';

/** Services shared by every feature module; module-specific inputs follow this bundle positionally. */
export interface ModuleDeps {
	plugin: Plugin;
	getSettings: () => SynapseSettings;
	notifications: NotificationManager;
	checkpointManager: CheckpointManager;
	registrar: CommandRegistrar;
	noteQueue: NoteOperationQueue;
}

/** Top-level settings sections that carry an `enabled` flag: one per feature module. */
export type FeatureSettingsKey = {
	[K in keyof SynapseSettings]: SynapseSettings[K] extends { enabled: boolean } ? K : never;
}[keyof SynapseSettings];

/** Lifecycle contract the module registry drives; the optional slots are the proposal-sidebar hooks main.ts injects. */
export interface FeatureModule {
	onload(): Promise<void>;
	onunload(): void;
	onViewRefreshNeeded?: (() => Promise<void>) | null;
	onOpenProposalView?: (() => void) | null;
}
