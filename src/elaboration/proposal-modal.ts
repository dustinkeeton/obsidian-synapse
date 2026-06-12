import { App, Modal } from 'obsidian';
import { Proposal } from './types';

export class ProposalDetailModal extends Modal {
	private onAccept: (content: string) => void;
	private onReject: () => void;

	constructor(
		app: App,
		private proposal: Proposal,
		callbacks: {
			onAccept: (content: string) => void;
			onReject: () => void;
		}
	) {
		super(app);
		this.onAccept = callbacks.onAccept;
		this.onReject = callbacks.onReject;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: `Proposal for: ${this.proposal.sourceNotePath}` });

		const reasons = this.proposal.detectionReasons
			.map(r => {
				switch (r.type) {
					case 'short-note': return `Short note (${r.wordCount} words)`;
					case 'todo-marker': return `TODO markers: ${r.markers.join(', ')}`;
					case 'empty-section': return `Empty section: "${r.heading}"`;
					case 'sparse-link': return `Linked from ${r.linkedFrom.length} notes`;
				}
			})
			.join(', ');

		contentEl.createEl('p', { text: `Detected: ${reasons}`, cls: 'synapse-detection-info' });

		contentEl.createEl('h3', { text: 'Proposed additions' });
		contentEl.createEl('p', { text: 'Edit the content below before accepting:' });

		const textarea = contentEl.createEl('textarea', {
			cls: 'synapse-proposal-editor',
		});
		textarea.value = this.proposal.proposedAdditions;
		textarea.rows = 12;

		const actions = contentEl.createDiv({ cls: 'synapse-modal-actions' });

		const acceptBtn = actions.createEl('button', {
			text: 'Accept',
			cls: 'mod-cta',
		});
		acceptBtn.addEventListener('click', () => {
			this.onAccept(textarea.value);
			this.close();
		});

		const rejectBtn = actions.createEl('button', { text: 'Reject' });
		rejectBtn.addEventListener('click', () => {
			this.onReject();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
