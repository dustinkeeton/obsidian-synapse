import { DATA_FOLDER } from './data-folder-migration';
import { redactSecrets } from './redact';

export const ACTIVITY_LOG_PATH = `${DATA_FOLDER}/activity.jsonl`;
/** The previous file after a rotation; older entries are dropped. */
export const ACTIVITY_LOG_ROTATED_PATH = `${DATA_FOLDER}/activity.1.jsonl`;
/** The current file rotates once an append would take it past this many bytes. */
export const ACTIVITY_LOG_MAX_BYTES = 512 * 1024;
export const ACTIVITY_MESSAGE_MAX_CHARS = 2000;
export const DEFAULT_EVENTS_LIMIT = 100;
export const MAX_EVENTS_LIMIT = 500;

/** `finish` / `error` / `cancelled`: an operation ended; `info` / `success` / `error`: a one-shot toast. */
export type ActivityLevel = 'finish' | 'cancelled' | 'error' | 'info' | 'success';

export interface ActivityInput {
	level: ActivityLevel;
	message: string;
	/** Operation id, for operation ends. */
	opId?: string;
	/** Operation label, e.g. "Generating deep dive". */
	label?: string;
	/** Public-API job the operation belongs to (#624). */
	jobId?: string;
}

/** One line of `.synapse/activity.jsonl` (#627). Text fields are redacted. */
export interface ActivityEntry extends ActivityInput {
	/** Increases by one per entry, across rotations and restarts; the `since` cursor. */
	seq: number;
	/** ISO time. */
	at: string;
}

export interface ActivityPage {
	entries: ActivityEntry[];
	/** Pass back to read on: the last returned `seq`, else the cursor given (0 when none). */
	cursor: number;
	/** More entries after this page. */
	more: boolean;
	/** Entries after the cursor were rotated away, or the cursor is past the newest entry because the log was deleted; the page then starts from the oldest kept entry. */
	missed: boolean;
}

/** The vault adapter calls the log uses (Obsidian's `DataAdapter`). */
export interface ActivityLogAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	append(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	stat(path: string): Promise<{ size: number } | null>;
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function parseLines(text: string): ActivityEntry[] {
	const entries: ActivityEntry[] = [];
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as ActivityEntry;
			if (typeof entry?.seq === 'number') entries.push(entry);
		} catch {
			// A torn last line (crash mid-append) is skipped.
		}
	}
	return entries;
}

/**
 * Append-only activity log (#627): every operation end and one-shot toast, redacted, as JSON lines.
 * Writes are serialized; a failed write is dropped so logging never breaks an operation.
 */
export class ActivityLog {
	private seq = 0;
	private size = 0;
	/** The file ends mid-line (a torn append), so the next line must start on a fresh one. */
	private torn = false;
	private chain: Promise<void>;

	constructor(private adapter: ActivityLogAdapter, private now: () => number = () => Date.now()) {
		this.chain = this.load().catch(() => undefined);
	}

	/** Queue an entry; resolves nothing, never throws. */
	record(input: ActivityInput): void {
		this.chain = this.chain.then(() => this.append(input)).catch(() => undefined);
	}

	/** Entries with `seq` above `cursor` (all kept entries when omitted), oldest first, at most `limit`. */
	async since(cursor = 0, limit = DEFAULT_EVENTS_LIMIT): Promise<ActivityPage> {
		await this.chain;
		const kept = [...await this.readFile(ACTIVITY_LOG_ROTATED_PATH), ...await this.readFile(ACTIVITY_LOG_PATH)];
		const newest = kept.length > 0 ? kept[kept.length - 1].seq : 0;
		// A cursor past the newest entry means the files were deleted and seq restarted: read from the start.
		const restarted = cursor > newest;
		const from = restarted ? 0 : cursor;
		const after = kept.filter((entry) => entry.seq > from);
		const entries = after.slice(0, Math.min(Math.max(1, limit), MAX_EVENTS_LIMIT));
		const oldest = kept[0]?.seq;
		return {
			entries,
			cursor: entries.length > 0 ? entries[entries.length - 1].seq : from,
			more: after.length > entries.length,
			missed: restarted || (oldest !== undefined && oldest > from + 1),
		};
	}

	/** Resolves once every queued entry is written (or dropped). */
	flush(): Promise<void> {
		return this.chain;
	}

	/** Read size, torn tail and last seq from the files; seq never goes backwards. */
	private async load(): Promise<void> {
		const current = await this.readText(ACTIVITY_LOG_PATH);
		this.size = byteLength(current);
		this.torn = current.length > 0 && !current.endsWith('\n');
		const last = parseLines(current).pop() ?? parseLines(await this.readText(ACTIVITY_LOG_ROTATED_PATH)).pop();
		this.seq = Math.max(this.seq, last?.seq ?? 0);
	}

	private async append(input: ActivityInput): Promise<void> {
		const entry: ActivityEntry = { seq: this.seq + 1, at: new Date(this.now()).toISOString(), level: input.level, message: clip(input.message) };
		if (input.opId) entry.opId = input.opId;
		if (input.label) entry.label = clip(input.label);
		if (input.jobId) entry.jobId = input.jobId;
		if (!(await this.adapter.exists(DATA_FOLDER))) await this.adapter.mkdir(DATA_FOLDER);
		// Another device (a synced vault) or the user changed the file since our last write: re-read it first.
		if (((await this.adapter.stat(ACTIVITY_LOG_PATH))?.size ?? 0) !== this.size) {
			await this.load();
			entry.seq = this.seq + 1;
		}
		const line = `${this.torn ? '\n' : ''}${JSON.stringify(entry)}\n`;
		const bytes = byteLength(line);
		if (this.size > 0 && this.size + bytes > ACTIVITY_LOG_MAX_BYTES) await this.rotate();
		if (this.size === 0 && !(await this.adapter.exists(ACTIVITY_LOG_PATH))) await this.adapter.write(ACTIVITY_LOG_PATH, line);
		else await this.adapter.append(ACTIVITY_LOG_PATH, line);
		this.size += bytes;
		this.seq = entry.seq;
		this.torn = false;
	}

	private async rotate(): Promise<void> {
		if (await this.adapter.exists(ACTIVITY_LOG_ROTATED_PATH)) await this.adapter.remove(ACTIVITY_LOG_ROTATED_PATH);
		await this.adapter.rename(ACTIVITY_LOG_PATH, ACTIVITY_LOG_ROTATED_PATH);
		this.size = 0;
		this.torn = false;
	}

	private async readFile(path: string): Promise<ActivityEntry[]> {
		return parseLines(await this.readText(path));
	}

	private async readText(path: string): Promise<string> {
		return (await this.adapter.exists(path)) ? this.adapter.read(path) : '';
	}
}

function clip(text: string): string {
	const redacted = redactSecrets(text);
	return redacted.length > ACTIVITY_MESSAGE_MAX_CHARS ? `${redacted.slice(0, ACTIVITY_MESSAGE_MAX_CHARS)}…` : redacted;
}
