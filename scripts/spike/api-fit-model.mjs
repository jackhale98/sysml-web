// SPIKE: what the app needs from an analysis, through the toolkit's wasm API:
// the model with source spans (time and size), diagnostics with severities and
// spans, and language services through the in-wasm LSP. Offsets: bytes vs UTF-16.
import { tk, library, open, demoFiles, time } from './tk-node.mjs';

const files = demoFiles();
const out = {};
const [s, buildMs] = time(() => open(files));
out.sessionBuildMs = buildMs;
const [findings, checkMs] = time(() => JSON.parse(s.check()));
out.check = { ms: checkMs, count: findings.length, sample: findings[0] };

// --- the model, several ways
const size = (str) => `${(str.length / 1024).toFixed(0)} KiB`;
let [r, ms] = time(() => s.toCompactJson());
out.compactJson = {
	ms,
	size: size(r),
	elements: JSON.parse(r).length,
	hasSpans: /"(start|span|line)"/.test(r)
};
[r, ms] = time(() => s.toFullJson(false));
out.fullJson = { ms, size: size(r) };
const shape = JSON.parse(
	s.outline(JSON.stringify({ outlineNodes: 1, shapeNodes: 100000, shapeDepth: 64 }))
).shape;
const fields = [
	'metaclass',
	'qualifiedName',
	'shortName',
	'owner',
	'declarationSite',
	'memberExtent',
	'valueSource',
	'docs'
];
[r, ms] = time(() => {
	const sh = s.outline(JSON.stringify({ outlineNodes: 1, shapeNodes: 100000, shapeDepth: 64 }));
	return (
		sh + s.rows(JSON.stringify(JSON.parse(sh).shape.nodes.map((n) => n.id)), JSON.stringify(fields))
	);
});
out.outlinePlusRows = { ms, size: size(r), namedElements: shape.nodes.length, fields };
// every element incl. anonymous ones (redefinitions, metadata, connections): walk members
const all = [];
(function walk(list) {
	for (const e of list) {
		all.push(s.elementId(e));
		walk(s.members(e));
	}
})(s.roots());
[r, ms] = time(() => s.rows(JSON.stringify(all), JSON.stringify(fields)));
out.rowsAllElements = {
	ms,
	size: size(r),
	elements: all.length,
	sample: JSON.parse(r).find((x) => x.shortName)
};
[r, ms] = time(() => s.toGraph(JSON.stringify({ view: 'tree' })));
out.treeGraph = { ms, size: size(r), nodes: JSON.parse(r).nodes.length };
// references with spans for every named element (the app's "where is this used")
let refCount = 0;
[r, ms] = time(() => {
	for (const n of shape.nodes)
		refCount += JSON.parse(s.references(JSON.stringify({ elementId: n.id }))).references.length;
});
out.referencesAllNamed = {
	ms,
	elements: shape.nodes.length,
	references: refCount,
	sample: JSON.parse(s.references('"DroneComponents::Battery"'))
};
out.units = JSON.parse(s.units())
	.slice(0, 2)
	.map((u) => ({ unit: u.unit, name: u.name }));

// --- offsets: bytes or UTF-16? A name with non-BMP and accented characters before an error.
const probe = [
	{ name: 'u.sysml', text: "package P { part def 'Wärme😀'; part x : 'Wärme😀'; part y : Nope; }" }
];
const f = JSON.parse(tk.check(JSON.stringify(probe)));
const s2 = tk.Session.fromSourcesWithPreparedLibrary(JSON.stringify(probe), library);
const fs2 = JSON.parse(s2.check());
const nope = probe[0].text.indexOf('Nope');
out.offsets = {
	textUtf16IndexOfNope: nope,
	textByteIndexOfNope: Buffer.byteLength(probe[0].text.slice(0, nope)),
	sessionCheckFinding: fs2.map((x) => ({
		col: x.col,
		line: x.line,
		start: x.start,
		end: x.end,
		message: x.message
	})),
	declarationSite: s2.declarationSite(s2.resolve('P::y')),
	references: JSON.parse(s2.references('"P::\'Wärme😀\'"')).references.map((x) => ({
		col: x.col,
		endCol: x.endCol
	})),
	utf16ColOfRef: probe[0].text.indexOf("'Wärme😀';", 30) + 1
};

// --- diagnostics on a broken file, through the session (lenient) and the LSP
const broken = files.map((x) =>
	x.name === 'system/Components.sysml'
		? { ...x, text: x.text.replace('port powerOut : PowerPort;', 'port powerOut : PowerPort') }
		: x
);
let threw = null;
try {
	tk.Session.fromSourcesWithPreparedLibrary(JSON.stringify(broken), library);
} catch (e) {
	threw = String(e).slice(0, 160);
}
const syntax = JSON.parse(tk.checkSyntax(JSON.stringify(broken)));
const lenientOut = JSON.parse(tk.lenientSources(JSON.stringify(broken)));
const lenient = JSON.stringify(lenientOut.sources);
const s3 = tk.Session.fromSourcesWithPreparedLibrary(lenient, library);
out.brokenFile = {
	sessionThrows: threw,
	checkSyntax: syntax.slice(0, 2),
	dropped: lenientOut.dropped.map((d) => ({
		unit: d.unit,
		line: d.line,
		col: d.col,
		text: d.text,
		message: d.message
	})),
	afterLenient: JSON.parse(s3.check()).map(
		(x) => `${x.severity} ${x.unit}:${x.line}:${x.col} ${x.message}`
	)
};

// --- LSP in wasm
const lsp = tk.LspServer.withPreparedLibrary(library);
let id = 1;
const notes = [];
const rpc = (method, params, notify) => {
	const m = { jsonrpc: '2.0', method, params };
	if (!notify) m.id = id++;
	const res = lsp.handle(JSON.stringify(m)).map((x) => JSON.parse(x));
	notes.push(...res.filter((x) => x.method));
	return notify ? res : res.find((x) => x.id === m.id);
};
const uri = (p) => 'file:///demo/' + p;
const [, lspInit] = time(() => {
	rpc('initialize', { capabilities: { general: { positionEncodings: ['utf-16'] } } });
	rpc('initialized', {}, true);
	lsp.setWorkspace(JSON.stringify(files.map((x) => ({ name: uri(x.name), text: x.text }))));
});
out.lsp = { initMs: lspInit };
const arch = files.find((x) => x.name === 'system/DroneArchitecture.sysml');
const pos = (text, needle, d = 0) => {
	const i = text.indexOf(needle) + d;
	const pre = text.slice(0, i).split('\n');
	return { line: pre.length - 1, character: pre.at(-1).length };
};
let [, openMs] = time(() =>
	rpc(
		'textDocument/didOpen',
		{ textDocument: { uri: uri(arch.name), languageId: 'sysml', version: 1, text: arch.text } },
		true
	)
);
out.lsp.didOpenMs = openMs;
const diag = notes.filter((n) => n.method === 'textDocument/publishDiagnostics');
out.lsp.publishDiagnostics = diag.map((d) => ({
	uri: d.params.uri,
	count: d.params.diagnostics.length
}));
const p = pos(arch.text, ': Battery', 3);
for (const [m, extra] of [
	['textDocument/hover', {}],
	['textDocument/definition', {}],
	['textDocument/references', { context: { includeDeclaration: true } }]
]) {
	const [res, t] = time(() =>
		rpc(m, { textDocument: { uri: uri(arch.name) }, position: p, ...extra })
	);
	const [, t2] = time(() =>
		rpc(m, { textDocument: { uri: uri(arch.name) }, position: p, ...extra })
	);
	out.lsp[m] = { firstMs: t, againMs: t2, result: JSON.stringify(res.result).slice(0, 220) };
}
const t2 = arch.text.replace('part camera : Camera;', 'part camera : Camera;\n        part x : ');
rpc(
	'textDocument/didChange',
	{ textDocument: { uri: uri(arch.name), version: 2 }, contentChanges: [{ text: t2 }] },
	true
);
notes.length = 0;
const [comp, cms] = time(() =>
	rpc('textDocument/completion', {
		textDocument: { uri: uri(arch.name) },
		position: pos(t2, 'part x : ', 9)
	})
);
const items = comp.result.items ?? comp.result;
out.lsp.completion = { ms: cms, items: items.length, first: items.slice(0, 8).map((i) => i.label) };
// diagnostics for the broken file through the LSP
const comps = broken.find((x) => x.name === 'system/Components.sysml');
notes.length = 0;
rpc(
	'textDocument/didOpen',
	{ textDocument: { uri: uri(comps.name), languageId: 'sysml', version: 1, text: comps.text } },
	true
);
out.lsp.brokenDiagnostics = notes
	.filter((n) => n.method === 'textDocument/publishDiagnostics')
	.flatMap((d) =>
		d.params.diagnostics.map((x) => ({
			severity: x.severity,
			range: x.range,
			message: x.message,
			source: x.source
		}))
	);
const [sem, sms] = time(() =>
	rpc('textDocument/semanticTokens/full', { textDocument: { uri: uri(arch.name) } })
);
out.lsp.semanticTokens = { ms: sms, tokens: sem.result.data.length / 5 };
console.log(JSON.stringify(out, null, 1));
