import { VERB_DEFINITIONS } from 'synapse-plugin-api';
import type { Capabilities, VerbSpec } from '../api-types.js';

/** The plugin's real verb list, every verb available, as `capabilities()` would return it. */
export async function pluginCapabilities(): Promise<Capabilities> {
    const definitions = VERB_DEFINITIONS as (Omit<VerbSpec, 'available'> & { feature?: unknown })[];
    return {
        apiVersion: 1,
        pluginVersion: 'test',
        verbs: definitions.map(({ feature: _feature, ...verb }) => ({ ...verb, available: true })),
    };
}
