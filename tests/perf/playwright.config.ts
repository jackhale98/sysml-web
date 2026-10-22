import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

/**
 * The browser benchmark (`npm run bench -- --browser`, `browser.bench.ts`):
 * the e2e suite's server and browser, one test at a time.
 */
export default defineConfig({
	...base,
	testDir: '.',
	testMatch: 'browser.bench.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 3_600_000,
	reporter: 'list'
});
