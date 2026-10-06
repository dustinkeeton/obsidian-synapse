import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, 'src/__mocks__/obsidian.ts'),
		},
	},
	// Production build shape; tests override the parsed BUILD_INFO instead.
	define: {
		__SYNAPSE_BUILD__: JSON.stringify(JSON.stringify({ dev: false })),
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		setupFiles: ['./src/__test-utils__/setup.ts'],
	},
});
