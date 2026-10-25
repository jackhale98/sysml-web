import { defineConfig } from 'vitest/config';

/** `npm run assess:conformance`: the conformance runner (`tests/conformance/`), not part of `npm test`. */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/conformance/**/*.conformance.ts'],
		testTimeout: 3_600_000,
		hookTimeout: 600_000
	}
});
