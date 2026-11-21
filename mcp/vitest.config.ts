import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		// The end-to-end tests load the plugin's real VERB_DEFINITIONS, whose imports reach `obsidian`.
		alias: {
			obsidian: fileURLToPath(new URL('../src/__mocks__/obsidian.ts', import.meta.url)),
			'synapse-plugin-api': fileURLToPath(new URL('../src/api/index.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
});
