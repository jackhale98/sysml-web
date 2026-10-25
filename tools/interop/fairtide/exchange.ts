/**
 * Fairtide's model exchange, driven from the command line with the app's own
 * code: the engine (`ToolkitHost`, as the unit tests load it) for SysML v2 JSON
 * export/import, and the Systems Modeling API client and save planning
 * (`src/lib/exchange/`) for servers such as SysON. Nothing here reimplements
 * the app's logic; it only calls it, so what it reports is what the app does
 * (minus the dialogs). Run through run.mjs:
 *
 *   check   <model dir> [--json out.json]        Fairtide's own diagnostics, per file
 *   export  <model dir> <out.json> [--library] [--derived]
 *   import  <in.json> <out dir>                  JSON -> SysML text files
 *   projects <api base>                          list projects (connectTo, as the app does)
 *   create  <api base> <name>                    SysmlApi.createProject, as the app does
 *   push    <api base> <project id> <model dir>  "Save to server" (plan + one commit)
 *   pull    <api base> <project id> <out dir>    "Open from server" (elements -> text)
 *   kpar    <model dir> <out.kpar> [name]        "Download as .kpar"
 *   unkpar  <in.kpar> <out dir>                  "Import" of a .kpar/.zip (files, warnings, skipped)
 *   semantics <model dir | elements.json[.gz]> [out.txt]   the model's meaning as facts
 *   compare <a> <b> [--json out.json]            compare two models' meaning (each a model
 *                                                dir, read by Fairtide's engine, or element JSON)
 *
 * Exit status: 0 done, 1 the step ran but reported a failure, 2 crashed.
 */
import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { connectTo, SysmlApi, type ApiBranch } from '#lib/exchange/api.ts';
import { readElements, type ElementJson } from '#lib/exchange/elements.ts';
import { changeCount, planPush, push } from '#lib/exchange/sync.ts';
import type { SourceFile } from '#lib/engine/protocol.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { readProjectArchive, writeKpar } from '#lib/interchange/kpar.ts';
import {
	compareDigests,
	differenceSize,
	digestLines,
	semanticDigest,
	type Digest
} from '#lib/interchange/semantics-testing.ts';

function modelFiles(dir: string): SourceFile[] {
	const root = resolve(dir);
	const out: SourceFile[] = [];
	const walk = (d: string) => {
		for (const name of readdirSync(d).sort()) {
			const path = join(d, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(sysml|kerml)$/.test(name))
				out.push({ path: relative(root, path), text: readFileSync(path, 'utf8') });
		}
	};
	walk(root);
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

function writeFiles(dir: string, files: SourceFile[]) {
	for (const f of files) {
		const path = join(dir, f.path);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, f.text);
	}
}

/** Fairtide's diagnostics for a model (what its Problems panel lists). */
async function check(dir: string, jsonOut?: string): Promise<number> {
	const host = await loadHost();
	const files = modelFiles(dir);
	const analyses = host.analyzeProject(files);
	let errors = 0;
	let warnings = 0;
	const report = analyses.map((a, i) => {
		const file = files[i]?.path ?? a.model.file;
		const issues = a.diagnostics
			.filter((d) => d.severity !== 'note')
			.map((d) => ({ severity: d.severity, code: d.code, message: d.message, span: d.span }));
		// Parse errors are reported on the model, not always among the diagnostics.
		for (const s of a.model.syntax_errors) {
			if (!issues.some((d) => d.message === s.message && d.span.from === s.span.from))
				issues.push({ severity: 'error', code: 'syntax', message: s.message, span: s.span });
		}
		const e = issues.filter((d) => d.severity === 'error').length;
		errors += e;
		warnings += issues.length - e;
		if (issues.length) {
			console.log(`${file}: ${e} error(s), ${issues.length - e} warning(s)`);
			for (const d of issues) {
				const at = `${d.span.start_row + 1}:${d.span.start_col + 1}`;
				console.log(`  ${d.severity.toUpperCase()} ${at} ${d.message}  [${d.code}]`);
			}
		}
		return { file, issues };
	});
	console.log(
		`\nFairtide check: ${files.length} file(s); ${errors} error(s), ${warnings} warning(s)`
	);
	if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ files: report, errors, warnings }, null, 1));
	return errors ? 1 : 0;
}

async function exportJson(dir: string, out: string, flags: string[]): Promise<number> {
	const host = await loadHost();
	const files = modelFiles(dir);
	const result = host.exportInterchange(files, {
		library: flags.includes('--library'),
		derived: flags.includes('--derived')
	});
	mkdirSync(dirname(resolve(out)), { recursive: true });
	writeFileSync(out, result.json);
	console.log(JSON.stringify({ files: files.length, ...result, json: undefined }, null, 2));
	return result.broken.length || result.dangling ? 1 : 0;
}

async function importJson(text: string, outDir: string): Promise<number> {
	const host = await loadHost();
	const result = host.importInterchange(text);
	writeFiles(outDir, result.files);
	const errors = result.problems.filter((p) => p.severity === 'error');
	console.log(
		JSON.stringify(
			{
				files: result.files.map((f) => f.path),
				elements: result.elements,
				carried: result.carried,
				notesByKind: result.notes.reduce<Record<string, number>>((acc, n) => {
					acc[n.kind] = (acc[n.kind] ?? 0) + 1;
					return acc;
				}, {}),
				notes: result.notes.slice(0, 40),
				problems: result.problems.slice(0, 40),
				errorCount: errors.length
			},
			null,
			2
		)
	);
	return errors.length ? 1 : 0;
}

/**
 * A model's meaning (`semantics-testing.ts`): a folder of SysML text as
 * Fairtide's engine reads it, or element JSON (any tool's; `.gz` too) as it
 * stands. The standard library is named by qualified name.
 */
function digestOf(host: ToolkitHost, source: string): Digest {
	const lookup = host.tk.Session.fromSourcesWithPreparedLibrary('[]', host.library);
	const outside = (id: string): string | null => {
		const h = lookup.elementById(id);
		if (!h) return null;
		let name = lookup.qualifiedName(h) ?? null;
		if (!name) {
			const member = JSON.parse(lookup.property(h, 'memberElement')) as { '@id': string } | null;
			if (member) name = `membership(${outside(member['@id']) ?? '?'})`;
		}
		h.free();
		return name;
	};
	try {
		if (statSync(source).isDirectory()) {
			const exported = host.exportInterchange(modelFiles(source), {});
			return semanticDigest(readElements(exported.json), outside);
		}
		const raw = readFileSync(source);
		const text = source.endsWith('.gz') ? gunzipSync(raw).toString() : raw.toString();
		return semanticDigest(readElements(text), outside);
	} finally {
		lookup.free();
	}
}

async function compare(a: string, b: string, jsonOut?: string): Promise<number> {
	const host = await loadHost();
	const difference = compareDigests(digestOf(host, a), digestOf(host, b));
	const size = differenceSize(difference);
	console.log(`compare ${a} ${b}: ${JSON.stringify(size)}`);
	for (const k of difference.onlyInFirst.slice(0, 30)) console.log(`  only in the first:  ${k}`);
	for (const k of difference.onlyInSecond.slice(0, 30)) console.log(`  only in the second: ${k}`);
	for (const c of difference.changed.slice(0, 60))
		console.log(`  ${c.key}: ${c.first.join('; ') || '-'}  =>  ${c.second.join('; ') || '-'}`);
	if (jsonOut) writeFileSync(jsonOut, JSON.stringify(difference, null, 1));
	return size.onlyInFirst || size.onlyInSecond || size.changed ? 1 : 0;
}

async function defaultBranch(api: SysmlApi, projectId: string): Promise<ApiBranch | null> {
	const project = await api.project(projectId);
	const branches = await api.branches(projectId);
	return branches.find((b) => b.id === project.defaultBranch) ?? branches[0] ?? null;
}

export async function main(args: string[]): Promise<number> {
	const [command, ...rest] = args;
	switch (command) {
		case 'check':
			return check(rest[0], rest[1] === '--json' ? rest[2] : undefined);
		case 'export':
			return exportJson(rest[0], rest[1], rest.slice(2));
		case 'import':
			return importJson(readFileSync(rest[0], 'utf8'), rest[1]);
		case 'projects': {
			const { api, projects } = await connectTo(rest[0], null);
			console.log(JSON.stringify({ base: api.base, projects }, null, 2));
			return 0;
		}
		case 'create': {
			const api = new SysmlApi(rest[0]);
			try {
				console.log(JSON.stringify(await api.createProject(rest[1], 'Made by Fairtide'), null, 2));
				return 0;
			} catch (error) {
				console.log(`createProject failed: ${error instanceof Error ? error.message : error}`);
				return 1;
			}
		}
		case 'push': {
			const [base, projectId, dir] = rest;
			const host = await loadHost();
			const files = modelFiles(dir);
			const exported = host.exportInterchange(files, {});
			const ours = readElements(exported.json);
			const api = new SysmlApi(base);
			const branch = await defaultBranch(api, projectId);
			const plan = await planPush(api, projectId, branch, ours);
			console.log(
				`plan: head ${plan.head}, ${ours.length} elements of ours, ${plan.matched} matched the server's; ` +
					`${plan.changes.created.length} to create, ${plan.changes.updated.length} to update, ` +
					`${plan.changes.deleted.length} to delete (${changeCount(plan.changes)} changes)`
			);
			try {
				const commit = await push(api, projectId, branch, plan, 'Saved from Fairtide');
				console.log(`commit answered: ${JSON.stringify(commit)}`);
			} catch (error) {
				console.log(`commit failed: ${error instanceof Error ? error.message : error}`);
				return 1;
			}
			const after = await defaultBranch(api, projectId);
			const now: ElementJson[] = after?.head ? await api.elements(projectId, after.head) : [];
			console.log(
				`after the commit: branch head ${after?.head}, ${now.length} elements on the server ` +
					`(we sent ${changeCount(plan.changes)} changes)`
			);
			return now.length >= ours.length ? 0 : 1;
		}
		case 'pull': {
			const [base, projectId, outDir] = rest;
			const api = new SysmlApi(base);
			const branch = await defaultBranch(api, projectId);
			if (!branch?.head) {
				console.log('pull: the project has no commit');
				return 1;
			}
			const elements = await api.elements(projectId, branch.head);
			console.log(`pull: ${elements.length} elements at ${branch.head}`);
			mkdirSync(outDir, { recursive: true });
			writeFileSync(join(outDir, '.server-elements.json'), JSON.stringify(elements));
			return importJson(JSON.stringify(elements), outDir);
		}
		case 'kpar': {
			const [dir, out, name] = rest;
			const files = modelFiles(dir);
			const bytes = await writeKpar({ name: name ?? 'model' }, files, new Date().toISOString());
			mkdirSync(dirname(resolve(out)), { recursive: true });
			writeFileSync(out, bytes);
			console.log(`kpar: ${files.length} file(s), ${bytes.length} bytes -> ${out}`);
			return 0;
		}
		case 'unkpar': {
			const [file, outDir] = rest;
			const archive = await readProjectArchive(new Uint8Array(readFileSync(file)), 'model');
			// This tool writes to disk: never outside outDir (the app keeps paths as they are).
			const unsafe = archive.files.filter(
				(f) =>
					f.path.startsWith('/') || /^[A-Za-z]:|\\/.test(f.path) || f.path.split('/').includes('..')
			);
			writeFiles(
				outDir,
				archive.files.filter((f) => !unsafe.includes(f))
			);
			if (unsafe.length)
				console.log(
					`unkpar: not written (outside the folder): ${unsafe.map((f) => f.path).join(', ')}`
				);
			console.log(
				JSON.stringify(
					{
						info: archive.info,
						files: archive.files.map((f) => f.path),
						skipped: archive.skipped,
						warnings: archive.warnings
					},
					null,
					2
				)
			);
			return archive.skipped.length || archive.warnings.length ? 1 : 0;
		}
		case 'semantics': {
			const lines = digestLines(digestOf(await loadHost(), rest[0])).join('\n') + '\n';
			if (rest[1]) writeFileSync(rest[1], lines);
			else process.stdout.write(lines);
			return 0;
		}
		case 'compare':
			return compare(rest[0], rest[1], rest[2] === '--json' ? rest[3] : undefined);
		default:
			console.error(
				'usage: run.mjs check|export|import|projects|create|push|pull|kpar|unkpar|semantics|compare ... (see tools/interop/fairtide/exchange.ts)'
			);
			return 2;
	}
}
