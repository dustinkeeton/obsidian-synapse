import { redactError } from './redact';

/** Proposal kinds an in-flight operation can produce; kept equal to `views/types` `ProposalKind` by a compile-time guard there. */
export type InProgressKind =
	| 'elaboration'
	| 'enrichment'
	| 'organize'
	| 'deep-dive'
	| 'title'
	| 'rem'
	| 'illustrate';

/** Opt-in metadata marking an operation as one that will produce proposals for review. */
export interface InProgressMeta {
	kind: InProgressKind;
	/** Note path or folder label the operation works on. */
	target?: string;
}

export interface InProgressEntry {
	id: string;
	kind: InProgressKind;
	label: string;
	target?: string;
	current?: number;
	total?: number;
	startedAt: number;
	cancellable: boolean;
}

export type InProgressListener = (entries: readonly InProgressEntry[]) => void;

/** Plugin-level registry of running proposal-producing operations, in start order. */
export class InProgressRegistry {
	private entries = new Map<string, InProgressEntry>();
	private listeners = new Set<InProgressListener>();

	begin(entry: Omit<InProgressEntry, 'startedAt'> & { startedAt?: number }): void {
		this.entries.delete(entry.id);
		this.entries.set(entry.id, { ...entry, startedAt: entry.startedAt ?? Date.now() });
		this.emit();
	}

	update(id: string, patch: Partial<Pick<InProgressEntry, 'label' | 'current' | 'total'>>): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.entries.set(id, { ...entry, ...patch });
		this.emit();
	}

	end(id: string): void {
		if (!this.entries.delete(id)) return;
		this.emit();
	}

	has(id: string): boolean {
		return this.entries.has(id);
	}

	snapshot(): InProgressEntry[] {
		return [...this.entries.values()].map((e) => ({ ...e }));
	}

	subscribe(listener: InProgressListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	clear(): void {
		if (this.entries.size === 0) return;
		this.entries.clear();
		this.emit();
	}

	private emit(): void {
		const snap = this.snapshot();
		for (const listener of [...this.listeners]) {
			try {
				listener(snap);
			} catch (err) {
				console.warn('[Synapse] In-progress listener failed:', redactError(err));
			}
		}
	}
}
