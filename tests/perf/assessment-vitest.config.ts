import { defineConfig } from 'vitest/config';

/** The assessment's engine benchmark (`assessment-engine.bench.ts`), not part of `npm test`. */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/perf/assessment-engine.bench.ts'],
		testTimeout: 7_200_000,
		hookTimeout: 600_000
	}
});
