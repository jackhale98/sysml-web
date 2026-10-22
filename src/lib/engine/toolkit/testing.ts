/**
 * For unit tests: the toolkit from `static/toolkit/` (fetched by
 * `scripts/fetch-toolkit.sh`), instantiated in Node, and the demo project.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { SourceFile } from '../protocol';
import type { Toolkit } from './api';
import { ToolkitHost } from './host';

const ROOT = resolve(import.meta.dirname, '../../../..');
const TOOLKIT = join(ROOT, 'static/toolkit');

let host: Promise<ToolkitHost> | undefined;
let memory: WebAssembly.Memory | undefined;

/** One host for the whole test file (the library takes about a second to load). */
export function loadHost(): Promise<ToolkitHost> {
	host ??= (async () => {
		if (!existsSync(join(TOOLKIT, 'sysmlv2.js')))
			throw new Error('static/toolkit is missing: run scripts/fetch-toolkit.sh');
		const tk = (await import(
			/* @vite-ignore */ pathToFileURL(join(TOOLKIT, 'sysmlv2.js')).href
		)) as Toolkit;
		({ memory } = await tk.default({
			module_or_path: readFileSync(join(TOOLKIT, 'sysmlv2_bg.wasm'))
		}));
		const bundle = gunzipSync(
			readFileSync(join(TOOLKIT, 'stdlib/sysml-library.json.gz'))
		).toString();
		return new ToolkitHost(tk, new tk.PreparedLibrary(bundle, null));
	})();
	return host;
}

/** The toolkit's WebAssembly memory, in MiB (it only grows). */
export function toolkitMemoryMiB(): number {
	return memory ? Math.round(memory.buffer.byteLength / 1048576) : 0;
}

/** The demo project's model files, sorted by path as the workspace sorts them. */
export function demoFiles(): SourceFile[] {
	const root = join(ROOT, 'src/demo/drone');
	const out: SourceFile[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(sysml|kerml)$/.test(name))
				out.push({ path: relative(root, path), text: readFileSync(path, 'utf8') });
		}
	};
	walk(root);
	return out.sort((a, b) => a.path.localeCompare(b.path));
}
