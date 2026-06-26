import { requestUrl } from 'obsidian';
import type { App, RequestUrlResponse } from 'obsidian';
import type { SynapseSettings } from '../settings';
import type { NotificationManager } from './notifications';
import { withRetry, isTransientNetworkError, describeNetworkError } from './api-utils';
import { isRecord } from './json-utils';

/**
 * In-app "a newer Synapse is available" check (#365).
 *
 * Synapse ships through the Obsidian community catalog, so the app already
 * auto-checks for updates — but the only signal is a small badge buried in
 * Settings → Community plugins. This service adds a louder, actionable prompt:
 * it polls the plugin's OWN public GitHub Releases API at most once per day,
 * compares the latest tag to the running version, and, when a newer release
 * exists, shows a sticky notice whose button jumps the user to the Community
 * plugins page to update.
 *
 * Design guarantees:
 *   - NEVER blocks load — the only entry point ({@link maybeCheck}) is fired
 *     from a delayed startup timer and is fully async.
 *   - FAILS SILENTLY — offline, non-200, or malformed responses are logged and
 *     swallowed; nothing here ever throws to the caller.
 *   - NEVER nags twice — a shown version is recorded so the same release does
 *     not re-prompt, and the whole feature is gated behind a settings toggle.
 *
 * Referencing the plugin's own public repo is safe: its GitHub links already
 * appear in the settings About section.
 */

/** The plugin's own public "latest release" endpoint. */
const RELEASES_LATEST_URL =
	'https://api.github.com/repos/dustinkeeton/obsidian-synapse/releases/latest';

/** Minimum spacing between network checks (24h) — load is never gated on this. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Per-attempt request timeout so a hung connection never lingers. */
const UPDATE_REQUEST_TIMEOUT_MS = 10_000;

/** Retry budget for transient network failures (not HTTP errors). */
const UPDATE_CHECK_MAX_RETRIES = 2;
const UPDATE_CHECK_RETRY_DELAY_MS = 1000;

/** The Community plugins settings tab id used by `app.setting.openTabById`. */
const COMMUNITY_PLUGINS_TAB_ID = 'community-plugins';

/**
 * Parse a semver string into its `[major, minor, patch]` numeric core, or
 * `null` when it is malformed. A leading `v` is stripped, missing trailing
 * components default to 0 (`1.2` → `[1, 2, 0]`), and any prerelease/build
 * suffix (`-rc.1`, `+build`) is ignored. Anything whose core isn't purely
 * numeric (e.g. `"latest"`, `""`, `"1.x"`) is rejected so callers can fail safe.
 */
function parseSemver(version: string): [number, number, number] | null {
	const core = version.trim().replace(/^v/i, '').split(/[-+]/)[0];
	const parts = core.split('.');
	if (parts.length === 0 || parts.length > 3) return null;
	const nums: number[] = [];
	for (const part of parts) {
		if (!/^\d+$/.test(part)) return null;
		nums.push(parseInt(part, 10));
	}
	while (nums.length < 3) nums.push(0);
	return [nums[0], nums[1], nums[2]];
}

/**
 * Whether `latest` is a strictly newer semver than `current`. Both inputs are
 * tolerant of a leading `v`. Returns `false` for equal, older, OR malformed
 * inputs — a parse failure must never trigger a spurious update prompt.
 */
export function isNewerVersion(latest: string, current: string): boolean {
	const l = parseSemver(latest);
	const c = parseSemver(current);
	if (!l || !c) return false;
	for (let i = 0; i < 3; i++) {
		if (l[i] > c[i]) return true;
		if (l[i] < c[i]) return false;
	}
	return false;
}

/** Collaborators injected into {@link UpdateChecker} (kept lean for testing). */
export interface UpdateCheckerDeps {
	/** The plugin's own manifest version, e.g. "1.0.6". */
	currentVersion: string;
	/** Used to feature-detect + open the Community plugins settings tab. */
	app: App;
	/** Surfaces the sticky "update available" notice. */
	notifications: NotificationManager;
	/** Live settings accessor — read fresh so a toggle change takes effect. */
	getSettings: () => SynapseSettings;
	/** Persists `updates.lastUpdateCheck` / `updates.dismissedUpdateVersion`. */
	saveSettings: () => Promise<void>;
}

export class UpdateChecker {
	constructor(private readonly deps: UpdateCheckerDeps) {}

	/**
	 * Startup entry point. Gated on the feature toggle and rate-limited to once
	 * per {@link UPDATE_CHECK_INTERVAL_MS}; the attempt timestamp is persisted up
	 * front so a failed/offline run still counts toward the limit. On finding a
	 * newer, not-yet-shown release it shows the notice and records the version so
	 * it never re-prompts. Fully guarded — never throws to the startup timer.
	 *
	 * `now` is injectable purely so tests can drive the rate-limit deterministically.
	 */
	async maybeCheck(now: number = Date.now()): Promise<void> {
		try {
			const settings = this.deps.getSettings();
			if (!settings.updates.enableUpdateNotifications) return;

			const last = settings.updates.lastUpdateCheck ?? 0;
			if (now - last < UPDATE_CHECK_INTERVAL_MS) return;

			// Record the attempt before the network round-trip so a failure still
			// rate-limits (and the timestamp survives a reload).
			settings.updates.lastUpdateCheck = now;
			await this.deps.saveSettings();

			const latest = await this.fetchLatestVersion();
			if (!latest) return; // offline / non-200 / malformed — already logged

			if (!isNewerVersion(latest, this.deps.currentVersion)) return;
			if (settings.updates.dismissedUpdateVersion === latest) return;

			this.notifyUpdateAvailable(latest);

			// Mark this release shown so it never nags twice, even if ignored.
			settings.updates.dismissedUpdateVersion = latest;
			await this.deps.saveSettings();
		} catch (error) {
			// Defense in depth: the startup path must never see a throw from here.
			console.warn('[Synapse] Update check encountered an unexpected error:', error);
		}
	}

	/**
	 * Fetch the latest release's version (tag, `v`-stripped) from GitHub, or
	 * `null` on any failure. Wraps a timed `requestUrl` in {@link withRetry},
	 * retrying only transient network errors. Uses `throw: false` so HTTP errors
	 * (e.g. 403 rate-limit, 404) resolve and degrade to a logged `null` rather
	 * than churning retries.
	 */
	private async fetchLatestVersion(): Promise<string | null> {
		try {
			const response = await withRetry(
				() => this.fetchReleaseResponse(),
				UPDATE_CHECK_MAX_RETRIES,
				UPDATE_CHECK_RETRY_DELAY_MS,
				(error) => isTransientNetworkError(error),
			);
			if (response.status !== 200) {
				console.warn(`[Synapse] Update check: GitHub returned status ${response.status}`);
				return null;
			}
			const body: unknown = response.json;
			if (!isRecord(body) || typeof body.tag_name !== 'string') {
				console.warn('[Synapse] Update check: release response missing a tag_name');
				return null;
			}
			return body.tag_name.trim().replace(/^v/i, '');
		} catch (error) {
			const detail =
				describeNetworkError(error, 'GitHub') ??
				(error instanceof Error ? error.message : String(error));
			console.warn('[Synapse] Update check failed:', detail);
			return null;
		}
	}

	/** Issue the release request, racing it against a hard timeout. */
	private fetchReleaseResponse(): Promise<RequestUrlResponse> {
		const timeout = new Promise<never>((_, reject) =>
			window.setTimeout(
				() => reject(new Error('Update check timed out')),
				UPDATE_REQUEST_TIMEOUT_MS,
			),
		);
		return Promise.race([
			requestUrl({
				url: RELEASES_LATEST_URL,
				method: 'GET',
				// GitHub's API documents a required User-Agent; Electron's net stack
				// usually supplies one, but set it explicitly so a UA-less request
				// can't 403 this check into a silent no-op.
				headers: {
					Accept: 'application/vnd.github+json',
					'User-Agent': 'obsidian-synapse',
				},
				throw: false,
			}),
			timeout,
		]);
	}

	/**
	 * Show the sticky "update available" notice with an Update action button.
	 * The message omits a "Synapse" prefix — NotificationManager already prepends
	 * one, so the toast reads "Synapse: v1.2.3 is available".
	 */
	private notifyUpdateAvailable(latest: string): void {
		this.deps.notifications.infoSticky(`v${latest} is available`, {
			label: 'Update',
			onClick: () => this.openCommunityPlugins(),
		});
	}

	/**
	 * Open Settings → Community plugins via the undocumented `app.setting` API.
	 * Feature-detected and fully guarded: if the API (or either method) is
	 * absent, fall back to a plain notice telling the user where to go.
	 */
	private openCommunityPlugins(): void {
		const setting = (this.deps.app as unknown as {
			setting?: { open?: () => void; openTabById?: (id: string) => void };
		}).setting;
		if (
			setting &&
			typeof setting.open === 'function' &&
			typeof setting.openTabById === 'function'
		) {
			setting.open();
			setting.openTabById(COMMUNITY_PLUGINS_TAB_ID);
			return;
		}
		this.deps.notifications.info('Open Settings → Community plugins to update Synapse.');
	}
}
