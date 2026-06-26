import { App, Modal } from 'obsidian';
import type SynapsePlugin from './main';
import { renderChangelog } from './changelog';
// CHANGELOG.md lives at the repo root and is inlined as a string at build time
// by esbuild's `.md` text loader (see esbuild.config.mjs + shared/markdown.d.ts).
import CHANGELOG from '../CHANGELOG.md';

/**
 * In-app changelog view (#375). A minimal `Modal` that renders the bundled
 * `CHANGELOG.md` so users can see what changed between versions without leaving
 * Obsidian. All parsing/rendering lives in the pure `changelog.ts` module; this
 * class is just the UI shell. Opened from the About section of the settings tab.
 */
export class ChangelogModal extends Modal {
	constructor(app: App, private plugin: SynapsePlugin) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-changelog');

		contentEl.createEl('h2', { text: "What's new in Synapse" });

		const body = contentEl.createDiv({ cls: 'synapse-changelog-body' });
		renderChangelog(body, CHANGELOG, this.plugin.manifest.version);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
