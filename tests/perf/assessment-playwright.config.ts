import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

/**
 * The assessment benchmark (`assessment-perf-ux.bench.ts`): the e2e suite's
 * server and browser, one test at a time.
 */
export default defineConfig({
	...base,
	testDir: '.',
	testMatch: 'assessment-perf-ux.bench.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 7_200_000,
	reporter: 'list'
});
