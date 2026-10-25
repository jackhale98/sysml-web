#!/usr/bin/env node
/**
 * Runs tools/interop/fairtide/exchange.ts with Fairtide's own engine and
 * exchange code (src/lib), compiled on the fly by Vite (no app build, no test
 * runner). Needs the app's node_modules and static/toolkit/
 * (scripts/fetch-toolkit.sh).
 *
 *   node tools/interop/fairtide/run.mjs <command> [args...]   (see exchange.ts)
 */
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({
	root,
	configFile: false,
	logLevel: 'error',
	plugins: [svelte({ compilerOptions: { runes: true } })],
	server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	appType: 'custom',
	optimizeDeps: { noDiscovery: true, include: [] }
});
let status;
try {
	const mod = await server.ssrLoadModule('/tools/interop/fairtide/exchange.ts');
	status = (await mod.main(process.argv.slice(2))) ?? 0;
} catch (error) {
	console.error(error instanceof Error ? (error.stack ?? error.message) : error);
	status = 2;
} finally {
	await server.close();
}
process.exit(status);
