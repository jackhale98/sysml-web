import { defineConfig } from 'vitest/config';

/** `npm run bench:engine`: the engine benchmark (`tests/perf/engine.bench.ts`), not part of `npm test`. */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/perf/engine.bench.ts'],
		testTimeout: 3_600_000,
		hookTimeout: 600_000
	}
});
