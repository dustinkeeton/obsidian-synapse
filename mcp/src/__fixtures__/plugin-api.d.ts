/** Vitest aliases this to the plugin's src/api; declared here so tsc does not type-check plugin source under this package's settings. */
declare module 'synapse-plugin-api' {
    export const VERB_DEFINITIONS: unknown;
}
