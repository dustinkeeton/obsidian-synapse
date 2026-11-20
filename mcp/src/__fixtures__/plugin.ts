import { fileURLToPath } from 'node:url';
import type { Capabilities, VerbSpec } from '../api-types.js';

/** The plugin source sits outside this package; a non-literal specifier keeps tsc from type-checking it under these settings. */
const PLUGIN_CAPABILITIES = fileURLToPath(new URL('../../../src/api/capabilities.ts', import.meta.url));

/** The plugin's real verb list, every verb available, as `capabilities()` would return it. */
export async function pluginCapabilities(): Promise<Capabilities> {
	const { VERB_DEFINITIONS } = await import(/* @vite-ignore */ PLUGIN_CAPABILITIES) as { VERB_DEFINITIONS: (Omit<VerbSpec, 'available'> & { feature?: unknown })[] };
	return {
		apiVersion: 1,
		pluginVersion: 'test',
		verbs: VERB_DEFINITIONS.map(({ feature: _feature, ...verb }) => ({ ...verb, available: true })),
	};
}
