// SPIKE: what the toolkit costs with no library at all (a "syntax tier" an app
// could show first: parse/context findings, outline, formatting, LSP syntax
// services), measured in Node on a fresh instance.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..');
const tk = await import(`${ROOT}/static/toolkit/sysmlv2.js`);
const out = tk.initSync({
	module: new WebAssembly.Module(fs.readFileSync(`${ROOT}/static/toolkit/sysmlv2_bg.opt.wasm`))
});
const mem = () => Math.round(out.memory.buffer.byteLength / 1048576);
const files = [];
(function walk(d) {
	for (const e of fs.readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) walk(p);
		else if (/\.sysml$/.test(e.name))
			files.push({
				name: path.relative(`${ROOT}/src/demo/drone`, p),
				text: fs.readFileSync(p, 'utf8')
			});
	}
})(`${ROOT}/src/demo/drone`);
const src = JSON.stringify(files);
const r = { memInit: mem() };
let t = performance.now();
const syn = JSON.parse(tk.checkSyntax(src));
r.checkSyntaxMs = Math.round(performance.now() - t);
r.syntaxFindings = syn.length;
r.memAfterCheckSyntax = mem();
t = performance.now();
const again = JSON.parse(tk.checkSyntax(src));
r.checkSyntaxAgainMs = Math.round(performance.now() - t);
t = performance.now();
const s = tk.Session.fromSources(src);
const f = JSON.parse(s.check());
r.sessionNoLibraryMs = Math.round(performance.now() - t);
r.sessionNoLibraryFindings = f.length;
r.unresolvedWithoutLibrary = s.unresolvedCount();
r.memAfterSessionNoLibrary = mem();
t = performance.now();
const lsp = new tk.LspServer();
lsp.handle(
	JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } })
);
lsp.setWorkspace(JSON.stringify(files.map((x) => ({ name: 'file:///p/' + x.name, text: x.text }))));
r.lspNoLibraryInitMs = Math.round(performance.now() - t);
r.memAfterLsp = mem();
console.log(JSON.stringify(r));
