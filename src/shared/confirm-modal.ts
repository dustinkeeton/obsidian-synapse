import { App, Modal, Setting } from 'obsidian';

/** Copy for a {@link ConfirmModal}. */
export interface ConfirmModalOptions {
	/** Heading shown at the top of the modal. */
	title: string;
	/** Body text explaining what will happen. */
	message: string;
	/** Label for the confirm (warning) button. Defaults to `Reset`. */
	confirmLabel?: string;
}

/**
 * Reusable yes/no confirmation modal (#420).
 *
 * Modeled on {@link DepthSelectorModal}: it keeps a `resolved` flag plus the
 * pending promise `resolve` so a dismiss (Escape / click-away → `onClose`)
 * settles as "cancelled" exactly once, and the button callbacks settle it
 * eagerly. Used to gate destructive resets behind an explicit confirmation
 * rather than the transient snackbar.
 */
export class ConfirmModal extends Modal {
	private opts: ConfirmModalOptions;
	private resolved = false;
	private resolve: (confirmed: boolean) => void = () => {};

	constructor(app: App, opts: ConfirmModalOptions) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('synapse-confirm-modal');

		contentEl.createEl('h3', { text: this.opts.title });
		contentEl.createEl('p', {
			cls: 'synapse-confirm-message',
			text: this.opts.message,
		});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Cancel').onClick(() => this.settle(false));
			})
			.addButton((btn) => {
				btn
					.setButtonText(this.opts.confirmLabel ?? 'Reset')
					.setWarning()
					.onClick(() => this.settle(true));
			});
	}

	onClose(): void {
		this.contentEl?.empty();
		// A dismiss (Escape / click-away) that never hit a button counts as cancel.
		if (!this.resolved) {
			this.resolve(false);
		}
	}

	/** Settle the pending promise once and close the modal. */
	private settle(confirmed: boolean): void {
		this.resolved = true;
		this.resolve(confirmed);
		this.close();
	}

	/**
	 * Open the modal and resolve to the user's choice: `true` on confirm, `false`
	 * on cancel or dismiss.
	 */
	openAndConfirm(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}
}
