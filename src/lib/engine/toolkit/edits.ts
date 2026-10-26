/**
 * Model edits on the toolkit (`EngineApi.edit`): every request becomes the
 * toolkit's span-preserving transform operations — `insertMember`,
 * `insertTopLevel`, `remove`, `rename`, `setFeatureType`, `setFeatureValue`,
 * `removeFeatureValue`, `setRedefinedFeature`, `setCommentBody` — which
 * splice at the spans its resolver recorded, reparse, and refuse any edit
 * that would silently rebind a reference.
 *
 * What it has no operation for (modifiers, short names, multiplicities,
 * specializations, where a new member goes in a body, how a doc comment is
 * laid out) is composed: the text change is worked out here (`header.ts`)
 * and the toolkit checks it by replacing the whole member with the changed
 * text (`replaceMember`), so it parses and every reference still resolves
 * to what it did. The result is the app's `EditResult`: minimal changes in
 * UTF-16 offsets against the texts in the request.
 *
 * Two refusals the app overrides, because people expect them to work: a
 * removal that leaves references unresolved, and a type change that
 * rebinds them. Both are made anyway (outside the toolkit) and the result
 * carries a warning saying what no longer resolves.
 */
import type { DeclarationSet, EditRequest, EditResult, FileChange } from '../types';
import type { TkElement, TkSession, TkSite, Toolkit } from './api';
import { withBomOf } from './bom';
import { diffTexts } from './diff';
import {
	applyTextChanges,
	blockComment,
	commentSafe,
	commentText,
	formatName,
	formatReference,
	insertIntoBody,
	lineIndent,
	planHeader,
	readHeader,
	removal,
	tokenize,
	unquote,
	type Header,
	type Span,
	type TextChange
} from './header';
import type { UnitInfo } from './model';
import { TextIndex } from './offsets';
import {
	effectiveType,
	fieldType,
	formatValue,
	parseFieldSpec,
	replacementValue,
	type FieldType
} from './values';

/** A splice as the toolkit reports it: bytes in the pre-commit text of `unit` (a path). */
interface TkSplice {
	unit: string;
	start: number;
	end: number;
	text: string;
}

interface TkReport {
	idMap: [string, string][];
	findings: string[];
	splices: TkSplice[];
}

type TkOp = Record<string, string | number>;

export interface EditEnvironment {
	tk: Toolkit;
	session: TkSession;
	/** Every project file, by path. */
	units: Map<string, UnitInfo>;
	/** A new session over these sources, for a step after a change the toolkit did not make. */
	reopen(sources: { name: string; text: string }[]): TkSession;
}

/** The toolkit refused: a syntax error the change would make. */
class SyntaxRefusal extends Error {}

/** The element an operation is about. */
interface Address {
	id?: string | undefined;
	name: string;
	line?: number | undefined;
}

/** An element found for an edit: its id and its member's place in the current text. */
interface Found {
	id: string;
	path: string;
	from: number;
	to: number;
	metaclass: string;
}

interface Member extends Found {
	name: string | null;
}

const EXPRESSION = /(Expression|^Literal\w*|^MultiplicityRange|^Multiplicity)$/;
const PARSE_REFUSAL = /does not parse|expected .*found|syntax/i;
const REFERENCE_REFUSAL =
	/breaks \d+ reference|would break|would no longer resolve|would resolve to/;

export class ModelEditing {
	private readonly env: EditEnvironment;
	/** The session for the current texts (`inSync`), or for the texts before the last host change. */
	session: TkSession;
	/** Whether the session the edit started from was edited. */
	editedOriginal = false;
	/** Whether `session` holds exactly `texts`. */
	inSync = true;
	/** Each file's text now, as the session parsed it (repaired files differ from the person's). */
	private readonly texts = new Map<string, string>();
	/** The changes of each step, per file, in UTF-16 offsets against the text before the step. */
	private readonly steps: Map<string, TextChange[]>[] = [];
	private readonly warnings: string[] = [];
	private unitIndex = new Map<string, number>();
	private pathOfUnit = new Map<number, string>();

	constructor(env: EditEnvironment) {
		this.env = env;
		this.session = env.session;
		for (const [path, unit] of env.units) this.texts.set(path, unit.repaired.text);
		this.indexUnits();
	}

	private indexUnits() {
		this.unitIndex.clear();
		this.pathOfUnit.clear();
		for (const u of JSON.parse(this.session.units()) as { unit: number; name: string }[]) {
			this.unitIndex.set(u.name, u.unit);
			this.pathOfUnit.set(u.unit, u.name);
		}
	}

	run(request: EditRequest): EditResult {
		try {
			this.dispatch(request);
		} catch (error) {
			if (error instanceof SyntaxRefusal) return { changes: [], syntaxErrors: [error.message] };
			throw error;
		}
		return this.result(request.path);
	}

	/** The files the edit changed, with their new texts (as the session parsed them). */
	changedTexts(): Map<string, string> {
		const out = new Map<string, string>();
		for (const [path, text] of this.texts)
			if (text !== this.env.units.get(path)?.repaired.text) out.set(path, text);
		return out;
	}

	private dispatch(request: EditRequest) {
		const path = request.path;
		switch (request.op) {
			case 'insertMember': {
				const owner = this.find(path, {
					id: request.parentId,
					name: request.parent,
					line: request.parentLine
				});
				this.commit([
					{ op: 'insertMember', owner: `@${owner.id}`, text: memberText(request.text) }
				]);
				return;
			}
			case 'insertTopLevel': {
				this.requireUnit(path);
				const text = memberText(request.text);
				// A blank line before it, as the file's other top-level members have.
				this.commit([{ op: 'insertTopLevel', unit: path, text: `\n${text.replace(/^\n+/, '')}` }]);
				return;
			}
			case 'remove':
				this.remove(this.find(path, { id: request.id, name: request.name, line: request.line }));
				return;
			case 'rename': {
				const element = this.find(path, { id: request.id, name: request.from, line: request.line });
				this.rename(element, unquote(request.to.trim()));
				return;
			}
			case 'setDeclaration': {
				const element = this.find(path, {
					id: request.id,
					name: request.element,
					line: request.line
				});
				this.setDeclaration(element, request.set);
				return;
			}
			case 'setField':
				this.setField(path, request);
				return;
			case 'setTableColumns':
				this.setTableColumns(path, request.view, request.columns);
				return;
			case 'setViewMetadata': {
				const view = this.find(path, { id: request.id, name: request.view });
				if (!this.header(view).parts.some((p) => p.slot === 'keyword' && p.word === 'view'))
					throw new Error(`\`${request.view}\` is not a view`);
				this.setMetadata(view, request.metadata, request.field, request.value);
				return;
			}
		}
	}

	// --- finding elements -----------------------------------------------------------------

	private requireUnit(path: string): number {
		const unit = this.unitIndex.get(path);
		if (unit === undefined) throw new Error(`${path} is not part of the project`);
		if (this.env.units.get(path)?.repair)
			throw new Error(`${path} has a syntax error; fix it before changing the model there.`);
		return unit;
	}

	private rows(ids: string[], fields: string[]): (Record<string, unknown> | null)[] {
		if (!ids.length) return [];
		return JSON.parse(this.session.rows(JSON.stringify(ids), JSON.stringify(fields))) as (Record<
			string,
			unknown
		> | null)[];
	}

	private index(path: string): TextIndex {
		return new TextIndex(this.texts.get(path) ?? '');
	}

	/** An element's member in the current text, from its row. */
	private place(id: string, row: Record<string, unknown> | null): Found | null {
		const site = row?.memberExtent as TkSite | null | undefined;
		if (!site) return null;
		const path = this.pathOfUnit.get(site.unit);
		if (!path) return null;
		const index = this.index(path);
		return {
			id,
			path,
			from: index.byteToUtf16(site.start),
			to: index.byteToUtf16(site.end),
			metaclass: String(row?.metaclass ?? '')
		};
	}

	private placeOf(id: string): Found {
		const found = this.place(id, this.rows([id], ['memberExtent', 'metaclass'])[0] ?? null);
		if (!found) throw new Error('that element has no text to change (is it in a library?)');
		return found;
	}

	/** Every element declared in `path`, in document order (expressions excepted). */
	private elementsIn(
		path: string
	): (Member & { qualifiedName: string | null; shortName: string | null })[] {
		const unit = this.requireUnit(path);
		const ids: string[] = [];
		const walk = (e: TkElement, depth: number) => {
			if (EXPRESSION.test(this.session.metaclass(e))) {
				e.free();
				return;
			}
			ids.push(this.session.elementId(e));
			const members = depth < 64 ? this.session.members(e) : [];
			e.free();
			for (const m of members) walk(m, depth + 1);
		};
		for (const root of this.session.roots()) {
			const site = this.session.memberExtent(root);
			if (site && (JSON.parse(site) as TkSite).unit === unit) walk(root, 0);
			else root.free();
		}
		const fields = ['metaclass', 'name', 'shortName', 'qualifiedName', 'memberExtent'];
		const rows = this.rows(ids, fields);
		const out: (Member & { qualifiedName: string | null; shortName: string | null })[] = [];
		ids.forEach((id, i) => {
			const row = rows[i] ?? null;
			const found = this.place(id, row);
			if (!found || found.path !== path) return;
			out.push({
				...found,
				name: typeof row?.name === 'string' && row.name ? row.name : null,
				shortName: typeof row?.shortName === 'string' ? row.shortName : null,
				qualifiedName: typeof row?.qualifiedName === 'string' ? row.qualifiedName : null
			});
		});
		return out;
	}

	/**
	 * The element an edit names: by id when it is in the file, else by name
	 * (simple or qualified, as written) preferring the one declared on `line`.
	 */
	private find(path: string, address: Address): Found {
		this.requireUnit(path);
		if (address.id) {
			const row = this.rows([address.id], ['memberExtent', 'metaclass'])[0] ?? null;
			const found = this.place(address.id, row);
			if (found?.path === path) return found;
		}
		const segments = splitPath(address.name);
		const want = segments.at(-1);
		if (!want) throw new Error('no element given');
		const all = this.elementsIn(path);
		const index = this.index(path);
		const lineOf = (e: Found) => index.lineColOf(e.from).line;
		let candidates = all.filter((e) => e.name === want || e.shortName === want);
		if (!candidates.length) {
			// An unnamed redefinition (`:>> mass`) is named by what it redefines.
			candidates = all.filter((e) => !e.name && redefinedName(this.texts.get(path)!, e) === want);
		}
		if (address.line) {
			const onLine = candidates.find((e) => lineOf(e) === address.line);
			if (onLine) return onLine;
		}
		const qualified = candidates.filter((e) =>
			endsWith(splitPath(e.qualifiedName ?? ''), segments)
		);
		if (qualified.length === 1 || (qualified.length && segments.length > 1)) return qualified[0]!;
		if (candidates.length === 1) return candidates[0]!;
		if (!candidates.length) throw new Error(`element \`${address.name}\` not found`);
		throw new Error(`element \`${address.name}\` is ambiguous here; give its line`);
	}

	/** The members of an element's body, in order, with their names (a redefinition's is what it redefines). */
	private members(owner: Found): Member[] {
		const e = this.session.elementById(owner.id);
		if (!e) return [];
		const handles = this.session.members(e);
		e.free();
		const ids = handles.map((h) => {
			const id = this.session.elementId(h);
			h.free();
			return id;
		});
		const rows = this.rows(ids, ['metaclass', 'name', 'memberExtent']);
		const text = this.texts.get(owner.path)!;
		const out: Member[] = [];
		ids.forEach((id, i) => {
			const row = rows[i] ?? null;
			const found = this.place(id, row);
			if (!found || found.path !== owner.path) return;
			if (found.from < owner.from || found.to > owner.to) return;
			const name = typeof row?.name === 'string' && row.name ? row.name : null;
			out.push({ ...found, name: name ?? redefinedName(text, found) });
		});
		return out;
	}

	private header(found: Found): Header {
		const header = readHeader(this.texts.get(found.path)!, found.from);
		if (!header) throw new Error('that declaration cannot be edited this way');
		return header;
	}

	// --- applying steps -----------------------------------------------------------------------

	/** Bring the session up to the current texts after a change the toolkit did not make. */
	private sync() {
		if (this.inSync) return;
		const sources = [...this.texts].map(([name, text]) => ({ name, text }));
		const next = this.env.reopen(sources);
		if (this.session !== this.env.session) this.session.free();
		this.session = next;
		this.inSync = true;
		this.indexUnits();
	}

	/** Run toolkit operations and take their splices. Throws the toolkit's refusal. */
	private commit(ops: TkOp[]): TkReport {
		this.sync();
		let report: TkReport;
		try {
			report = JSON.parse(this.session.edit(JSON.stringify(ops))) as TkReport;
		} catch (error) {
			throw refusal(error);
		}
		if (this.session === this.env.session) this.editedOriginal = true;
		this.takeSplices(report.splices);
		return report;
	}

	/** Whether the toolkit would make these operations (the session is untouched). */
	private check(ops: TkOp[]): { ok: true } | { ok: false; refusal: string } {
		this.sync();
		const r = JSON.parse(this.session.checkEdit(JSON.stringify(ops))) as {
			wouldCommit: boolean;
			refusal?: string;
		};
		return r.wouldCommit ? { ok: true } : { ok: false, refusal: r.refusal ?? 'refused' };
	}

	private takeSplices(splices: TkSplice[]) {
		const byPath = new Map<string, TextChange[]>();
		for (const s of splices) {
			const index = this.index(s.unit);
			const list = byPath.get(s.unit) ?? [];
			// The toolkit indents the blank lines of inserted text; the app's files have none.
			const insert = s.text.replace(/^[ \t]+$/gm, '');
			if (insert !== s.text) this.inSync = false;
			list.push({ from: index.byteToUtf16(s.start), to: index.byteToUtf16(s.end), insert });
			byPath.set(s.unit, list);
		}
		this.step(byPath);
	}

	private step(byPath: Map<string, TextChange[]>) {
		if (!byPath.size) return;
		for (const [path, changes] of byPath) {
			this.requireUnit(path);
			this.texts.set(path, applyTextChanges(this.texts.get(path)!, changes));
		}
		this.steps.push(byPath);
	}

	/** Make changes the toolkit was asked about but would not make. */
	private force(path: string, changes: TextChange[]) {
		this.step(new Map([[path, changes]]));
		this.inSync = false;
	}

	/**
	 * Change the text of one member, checked by the toolkit: the member is
	 * replaced by the changed text, which must parse as one member and keep
	 * every reference resolving as before. `allowBroken` makes the change
	 * anyway when only references would break, with a warning.
	 */
	private compose(target: Found, changes: TextChange[], allowBroken = false) {
		if (!changes.length) return;
		const text = this.texts.get(target.path)!;
		const edited = applyTextChanges(text, changes);
		const growth = edited.length - text.length;
		const member = edited.slice(target.from, target.to + growth);
		const ops = [
			{
				op: 'replaceMember',
				target: `@${target.id}`,
				text: dedent(member, lineIndent(text, target.from))
			}
		];
		this.sync();
		let report: TkReport;
		try {
			report = JSON.parse(this.session.edit(JSON.stringify(ops))) as TkReport;
		} catch (error) {
			const r = refusal(error);
			if (allowBroken && REFERENCE_REFUSAL.test(r.message)) {
				this.warnings.push(brokenReferences(r.message));
				this.force(target.path, changes);
				return;
			}
			throw r;
		}
		if (this.session === this.env.session) this.editedOriginal = true;
		// The toolkit re-indents the member; when that gives back our text, the session holds it.
		const index = this.index(target.path);
		const theirs = applyTextChanges(
			text,
			report.splices
				.filter((s) => s.unit === target.path)
				.map((s) => ({
					from: index.byteToUtf16(s.start),
					to: index.byteToUtf16(s.end),
					insert: s.text
				}))
		);
		this.step(new Map([[target.path, changes]]));
		if (theirs !== edited || report.splices.some((s) => s.unit !== target.path))
			this.inSync = false;
	}

	// --- operations --------------------------------------------------------------------------

	private remove(target: Found) {
		const ops = [{ op: 'remove', target: `@${target.id}` }];
		const checked = this.check(ops);
		const text = this.texts.get(target.path)!;
		if (checked.ok) {
			const cut = removal(text, target.from, target.to);
			// A member sharing its line (`{ a = 1; b = 2; }`) goes with one blank, not just its own text.
			if (cut.from !== lineStartOf(text, target.from)) this.force(target.path, [cut]);
			else this.commit(ops);
			return;
		}
		if (!REFERENCE_REFUSAL.test(checked.refusal)) throw refusal(checked.refusal);
		// People delete things that are used; the problems list then shows what to fix.
		this.warnings.push(this.whatBreaks(target, checked.refusal));
		this.force(target.path, [removal(text, target.from, target.to)]);
	}

	/** "2 references to Motor no longer resolve (in Rotor::motor, …)." */
	private whatBreaks(target: Found, message: string): string {
		const count = Number(/breaks (\d+) reference/.exec(message)?.[1] ?? 0);
		const name = this.rows([target.id], ['name'])[0]?.name;
		let owners: string[] = [];
		try {
			const refs = JSON.parse(
				this.session.references(JSON.stringify({ elementId: target.id }))
			) as {
				references: { owner: { qualifiedName: string } | null }[];
			};
			owners = [
				...new Set(
					refs.references.map((r) => r.owner?.qualifiedName).filter((q): q is string => !!q)
				)
			];
		} catch {
			// The count alone, then.
		}
		const what = typeof name === 'string' && name ? name : 'it';
		const n = count || owners.length;
		const where = owners.length
			? ` (${owners.slice(0, 3).map(displayName).join(', ')}${owners.length > 3 ? ', …' : ''})`
			: '';
		return n === 1
			? `1 reference to ${displayName(what)} no longer resolves${where}.`
			: `${n || 'Some'} references to ${displayName(what)} no longer resolve${where}.`;
	}

	private rename(target: Found, name: string) {
		if (!name) throw new Error('A name cannot be empty.');
		const current = this.rows([target.id], ['name'])[0]?.name;
		if (current === name) return;
		const report = this.commit([{ op: 'rename', target: `@${target.id}`, newName: name }]);
		if (!report.splices.length && report.findings.length)
			throw new Error(report.findings.join(' '));
	}

	private setDeclaration(target: Found, set: DeclarationSet) {
		const { doc, ...fields } = set;
		if (Object.values(fields).some((v) => v !== undefined)) {
			const text = this.texts.get(target.path)!;
			const header = this.header(target);
			const changes = planHeader(text, header, fields);
			if (changes.length) {
				const direct = directOp(header, fields, target.id);
				if (direct) this.direct(target, direct, changes, fields.type !== undefined);
				else this.compose(target, changes, fields.type !== undefined);
			}
		}
		if (doc !== undefined) this.setDoc(this.refind(target), doc);
	}

	/** The element again after a step (its id stays while its name does). */
	private refind(target: Found): Found {
		return this.placeOf(target.id);
	}

	/**
	 * A toolkit operation for a change `changes` also describes; when the
	 * toolkit refuses a type change because references would rebind, the
	 * change is made anyway, with a warning.
	 */
	private direct(target: Found, op: TkOp, changes: TextChange[], allowBroken: boolean) {
		const checked = this.check([op]);
		if (checked.ok) {
			this.commit([op]);
			return;
		}
		if (allowBroken && REFERENCE_REFUSAL.test(checked.refusal)) {
			this.warnings.push(brokenReferences(checked.refusal));
			this.force(target.path, changes);
			return;
		}
		// The toolkit can't place it (e.g. several written types): compose it instead.
		if (/multiple|cannot|no .* to/.test(checked.refusal) && !PARSE_REFUSAL.test(checked.refusal)) {
			this.compose(target, changes, allowBroken);
			return;
		}
		throw refusal(checked.refusal);
	}

	private setDoc(target: Found, value: string | null) {
		const want = value?.trim() ? value.trim().replace(/\r/g, '') : null;
		const text = this.texts.get(target.path)!;
		const members = this.members(target);
		const doc = members.find((m) => m.metaclass === 'Documentation');
		if (doc) {
			const comment = tokenize(text, doc.from, doc.to).find(
				(t) => t.kind === 'comment' && t.text.startsWith('/*')
			);
			if (!comment) throw new Error('the documentation has no comment to change');
			if (want === commentText(comment.text)) return;
			if (!want) {
				this.commit([{ op: 'remove', target: `@${doc.id}` }]);
				return;
			}
			const laidOut = blockComment(text, comment, want);
			if (!laidOut.includes('\n')) {
				this.commit([{ op: 'setCommentBody', target: `@${doc.id}`, body: commentSafe(want) }]);
				return;
			}
			this.compose(doc, [{ from: comment.start, to: comment.end, insert: laidOut }]);
			return;
		}
		if (!want) return;
		const member = `doc ${blockComment(text, null, want)}`;
		this.compose(target, [
			insertIntoBody(text, this.header(target), members.map(span), null, member)
		]);
	}

	// --- table cells ---------------------------------------------------------------------------

	private setField(path: string, request: Extract<EditRequest, { op: 'setField' }>) {
		const spec = parseFieldSpec(request.field);
		const value = request.value;
		if (spec.kind === 'metadata' && request.line) {
			// A metadata row (`@Fmea about x { … }`) points at the annotation itself.
			const annotation = this.elementsIn(path).find(
				(e) =>
					e.metaclass === 'MetadataUsage' &&
					this.index(path).lineColOf(e.from).line === request.line &&
					this.metadataType(e) === spec.type
			);
			if (annotation) {
				const resolved = this.metadataFieldType(spec.type, spec.field, annotation);
				this.setAnnotationField(annotation, spec.field, value, resolved);
				return;
			}
		}
		const target = this.find(path, { id: request.id, name: request.element, line: request.line });
		switch (spec.kind) {
			case 'name': {
				const name = value.trim();
				if (!name) throw new Error('a name cannot be empty');
				this.rename(target, name);
				return;
			}
			case 'shortName':
				this.compose(
					target,
					planHeader(this.texts.get(path)!, this.header(target), { shortName: value })
				);
				return;
			case 'doc':
				this.setDoc(target, value);
				return;
			case 'feature':
				this.setFeature(target, spec.feature, value);
				return;
			case 'metadata':
				this.setMetadata(target, spec.type, spec.field, value);
				return;
		}
	}

	private setFeature(target: Found, feature: string, value: string) {
		const clear = !value.trim();
		const text = this.texts.get(target.path)!;
		const members = this.members(target);
		const existing = members.find((m) => m.name === feature && isFeatureMember(text, m));
		const resolved = clear ? null : this.featureType(target, feature);
		if (existing) {
			const header = this.header(existing);
			const part = header.parts.find((p) => p.slot === 'value');
			const expr = part?.expression ? text.slice(part.expression.start, part.expression.end) : null;
			if (clear) {
				if (header.body && part)
					this.commit([{ op: 'removeFeatureValue', target: `@${existing.id}` }]);
				else if (!header.body) this.remove(existing);
				return;
			}
			const ty = effectiveType(resolved, expr);
			const written = expr === null ? formatValue(ty, value) : replacementValue(ty, expr, value);
			if (written !== expr)
				this.commit([{ op: 'setFeatureValue', target: `@${existing.id}`, expr: written }]);
			return;
		}
		if (clear) return;
		const ty = effectiveType(resolved, null);
		const member = `:>> ${formatName(feature)} = ${formatValue(ty, value)};`;
		const after =
			members.findLast((m) => isFeatureMember(text, m)) ??
			members.findLast((m) => m.metaclass === 'Documentation') ??
			null;
		this.compose(target, [
			insertIntoBody(text, this.header(target), members.map(span), after && span(after), member)
		]);
	}

	private setMetadata(target: Found, type: string, field: string, value: string) {
		const clear = !value.trim();
		const members = this.members(target);
		const own = members.find(
			(m) => m.metaclass === 'MetadataUsage' && this.metadataType(m) === type && !this.isAbout(m)
		);
		const annotation = own ?? this.annotationAbout(target, type);
		const resolved = clear ? null : this.metadataFieldType(type, field, target);
		if (annotation) {
			this.setAnnotationField(annotation, field, value, resolved);
			return;
		}
		if (clear) return;
		const text = this.texts.get(target.path)!;
		const ty = effectiveType(resolved, null);
		const spelled = this.spellMetadata(target, type);
		const member = `@${spelled} { ${formatName(field)} = ${formatValue(ty, value)}; }`;
		const header = this.header(target);
		const after =
			members.findLast((m) => m.metaclass === 'MetadataUsage') ??
			members.findLast((m) => isFeatureMember(text, m)) ??
			null;
		this.compose(target, [
			insertIntoBody(
				text,
				header,
				members.map(span),
				after ? span(after) : lastInBody(text, header),
				member
			)
		]);
	}

	private setAnnotationField(
		annotation: Found,
		field: string,
		value: string,
		resolved: FieldType | null
	) {
		const clear = !value.trim();
		const text = this.texts.get(annotation.path)!;
		const header = this.header(annotation);
		if (!header.body) {
			if (clear) return;
			const ty = effectiveType(resolved, null);
			const semi = header.parts.find((p) => p.slot === 'body');
			if (!semi) throw new Error('the annotation has neither a body nor a closing `;`');
			const assignment = `${formatName(field)} = ${formatValue(ty, value)};`;
			this.compose(annotation, [{ from: semi.start, to: semi.end, insert: ` { ${assignment} }` }]);
			return;
		}
		const members = this.members(annotation);
		const existing = members.find((m) => m.name === field);
		if (existing && clear) {
			if (members.length === 1) this.remove(annotation);
			else this.remove(existing);
			return;
		}
		if (existing) {
			const part = this.header(existing).parts.find((p) => p.slot === 'value');
			if (!part?.expression) throw new Error(`\`${field}\` has no value to replace`);
			const expr = text.slice(part.expression.start, part.expression.end);
			const written = replacementValue(effectiveType(resolved, expr), expr, value);
			if (written !== expr)
				this.commit([{ op: 'setFeatureValue', target: `@${existing.id}`, expr: written }]);
			return;
		}
		if (clear) return;
		const ty = effectiveType(resolved, null);
		const assignment = `${formatName(field)} = ${formatValue(ty, value)};`;
		this.compose(annotation, [
			insertIntoBody(text, header, members.map(span), lastInBody(text, header), assignment)
		]);
	}

	private setTableColumns(path: string, view: string, columns: string[]) {
		const target = this.find(path, { name: view });
		const header = this.header(target);
		if (!header.parts.some((p) => p.slot === 'keyword' && p.word === 'view'))
			throw new Error(`\`${view}\` is not a view`);
		const cols = columns.map((c) => c.trim()).filter(Boolean);
		if (!cols.length && header.family === 'definition')
			throw new Error('a view def needs at least one column');
		const own = this.members(target).find(
			(m) => m.metaclass === 'MetadataUsage' && this.metadataType(m) === 'TableRendering'
		);
		const annotation = own ?? this.annotationAbout(target, 'TableRendering');
		const text = fieldType('text');
		if (annotation) {
			this.setAnnotationField(annotation, 'columns', cols.join('; '), text);
			return;
		}
		this.setMetadata(target, 'TableRendering', 'columns', cols.join('; '));
	}

	// --- types of fields ------------------------------------------------------------------------

	private withElement<T>(id: string, read: (e: TkElement) => T): T | null {
		const e = this.session.elementById(id);
		if (!e) return null;
		try {
			return read(e);
		} finally {
			e.free();
		}
	}

	/** The simple name of a metadata usage's type. */
	private metadataType(m: Found): string | null {
		return this.withElement(m.id, (e) => {
			const types = this.session.typings(e);
			const name = types[0] ? (this.session.name(types[0]) ?? null) : null;
			for (const t of types) t.free();
			return name;
		});
	}

	private isAbout(m: Found): boolean {
		return /\babout\b/.test(this.texts.get(m.path)!.slice(m.from, m.to).split('{')[0]!);
	}

	/** `@T about element { … }` elsewhere in the element's file. */
	private annotationAbout(target: Found, type: string): Found | null {
		const all = this.elementsIn(target.path).filter(
			(e) => e.metaclass === 'MetadataUsage' && this.metadataType(e) === type && this.isAbout(e)
		);
		for (const m of all) {
			const about = this.withElement(m.id, (e) => {
				const annotated = this.session.annotatedElements(e);
				const ids = annotated.map((a) => this.session.elementId(a));
				for (const a of annotated) a.free();
				return ids;
			});
			if (about?.includes(target.id)) return m;
		}
		return null;
	}

	/** The type of feature `feature` of an element, from its declaration in the element's types. */
	private featureType(target: Found, feature: string): FieldType | null {
		const qualified = this.rows([target.id], ['qualifiedName'])[0]?.qualifiedName;
		if (typeof qualified !== 'string') return null;
		return this.typeOfFeature(`${qualified}::${formatName(feature)}`, target);
	}

	private metadataFieldType(type: string, field: string, context: Found): FieldType | null {
		const def = this.metadataDefinition(type);
		if (!def) return null;
		const qualified = this.withElement(def, (e) => this.session.qualifiedName(e) ?? null);
		return qualified ? this.typeOfFeature(`${qualified}::${formatName(field)}`, context) : null;
	}

	/** The metadata definition named `type`: the project's, else the library's. */
	private metadataDefinition(type: string): string | null {
		let own: string | null = null;
		let library: string | null = null;
		for (const d of this.session.elementsOfMetaclass('MetadataDefinition')) {
			if (this.session.name(d) === type) {
				if (this.session.isLibraryElement(d)) library ??= this.session.elementId(d);
				else own ??= this.session.elementId(d);
			}
			d.free();
		}
		return own ?? library;
	}

	private spellMetadata(context: Found, type: string): string {
		const def = this.metadataDefinition(type);
		if (!def) return formatName(type);
		return this.spell(context.id, def) ?? formatName(type);
	}

	/** The shortest spelling of `target` that resolves to it from `context`. */
	private spell(context: string, target: string): string | null {
		const c = this.session.elementById(context);
		const t = this.session.elementById(target);
		try {
			return (c && t && this.session.minimalSpelling(c, t)) || null;
		} finally {
			c?.free();
			t?.free();
		}
	}

	private typeOfFeature(qualifiedName: string, context: Found): FieldType | null {
		const s = this.session;
		const feature = s.resolve(qualifiedName);
		if (!feature) return null;
		const root = s.redefinitionRoot(feature);
		feature.free();
		try {
			if (s.metaclass(root) !== 'AttributeUsage') return null;
			const types = s.typings(root);
			const type = types[0];
			for (const t of types.slice(1)) t.free();
			if (!type) return null;
			try {
				return this.classify(type, isMany(s, root), context);
			} finally {
				type.free();
			}
		} finally {
			root.free();
		}
	}

	private classify(type: TkElement, many: boolean, context: Found): FieldType {
		const s = this.session;
		if (s.metaclass(type) === 'EnumerationDefinition') {
			const literals = s
				.members(type)
				.filter((m) => {
					const keep = s.metaclass(m) === 'EnumerationUsage';
					if (!keep) m.free();
					return keep;
				})
				.map((m): [string, string] => {
					const name = s.name(m) ?? '';
					m.free();
					return [name, formatName(name)];
				});
			const enumType = this.spell(context.id, s.elementId(type));
			return {
				kind: many ? 'enumList' : 'enum',
				...(enumType ? { enumType } : {}),
				literals
			};
		}
		const conforms = (name: string) => {
			const general = s.resolve(name);
			if (!general) return false;
			try {
				return s.conforms(type, general);
			} finally {
				general.free();
			}
		};
		if (conforms('ScalarValues::String')) return fieldType('text');
		if (conforms('ScalarValues::Boolean'))
			return {
				kind: 'enum',
				literals: [
					['true', 'true'],
					['false', 'false']
				]
			};
		if (
			conforms('ScalarValues::NumericalValue') ||
			conforms('Quantities::ScalarQuantityValue') ||
			/Value$/.test(s.name(type) ?? '')
		)
			return fieldType('number');
		return fieldType();
	}

	// --- the result --------------------------------------------------------------------------------

	private result(path: string): EditResult {
		const changes: TextChange[] = [];
		const otherFiles: FileChange[] = [];
		for (const [file, final] of this.changedTexts()) {
			const unit = this.env.units.get(file)!;
			if (unit.repair)
				throw new Error(`${file} has a syntax error; fix it before changing the model there.`);
			const touched = this.steps.filter((s) => s.has(file));
			const list =
				touched.length === 1
					? minimize(unit.original.text, touched[0]!.get(file)!)
					: diffTexts(unit.original.text, withBomOf(unit.original.text, final));
			if (file === path) changes.push(...list);
			else otherFiles.push(...list.map((c) => ({ path: file, ...c })));
		}
		changes.sort((a, b) => a.from - b.from);
		const result: EditResult = { changes, syntaxErrors: [] };
		if (otherFiles.length) result.otherFiles = otherFiles;
		if (this.warnings.length) result.warning = this.warnings.join(' ');
		return result;
	}
}

// --- helpers -------------------------------------------------------------------------------------

function refusal(error: unknown): Error {
	const message = String(error instanceof Error ? error.message : error).replace(/^Error:\s*/, '');
	return PARSE_REFUSAL.test(message) ? new SyntaxRefusal(message) : new Error(message);
}

/** "Some references no longer resolve or now mean something else: imageOut (line 57), …" */
function brokenReferences(message: string): string {
	const sites = [...message.matchAll(/`([^`]+)` at [^:]+:(\d+):\d+/g)].map(
		([, name, line]) => `${name} (line ${line})`
	);
	const list = sites.length
		? `: ${sites.slice(0, 4).join(', ')}${sites.length > 4 ? ', …' : ''}`
		: '';
	return `${sites.length === 1 ? 'A reference' : 'Some references'} no longer resolve${sites.length === 1 ? 's' : ''} as before${list}.`;
}

const span = (m: Found): Span => ({ start: m.from, end: m.to });

const lineStartOf = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;

const displayName = (qualified: string) => splitPath(qualified).join('::');

/**
 * The segments of a qualified name or chain, unquoted: `A::'b c'` → `A`,
 * `b c`. A name with neither `::` nor `.` is one segment, even unquoted
 * (`Flight endurance`, as a label shows it).
 */
function splitPath(name: string): string[] {
	const tokens = tokenize(name.trim());
	if (!tokens.some((t) => t.text === '::' || t.text === '.'))
		return name.trim() ? [unquote(name.trim())] : [];
	const out: string[] = [];
	for (const t of tokens) if (t.kind === 'word' || t.kind === 'name') out.push(unquote(t.text));
	return out;
}

/** Where the last statement of a body ends, as a place to add a member after; null for an empty body. */
function lastInBody(text: string, header: Header): Span | null {
	if (!header.body) return null;
	let end = header.body.close;
	while (end > header.body.open + 1 && /\s/.test(text[end - 1]!)) end--;
	return end > header.body.open + 1 ? { start: end, end } : null;
}

const endsWith = (list: string[], tail: string[]) =>
	tail.length <= list.length && tail.every((s, i) => list[list.length - tail.length + i] === s);

/** The name an unnamed redefinition takes from what it redefines (`:>> mass` → `mass`). */
function redefinedName(text: string, member: Found): string | null {
	const header = readHeader(text, member.from);
	const target = header?.parts.find((p) => p.slot === 'redefinition')?.targets?.[0];
	if (!target) return null;
	return splitPath(text.slice(target.start, target.end)).at(-1) ?? null;
}

/** A member that sets a feature: `:>> f = v;`, `attribute f = v;`, `f = v;`. */
function isFeatureMember(text: string, member: Member): boolean {
	if (!member.name || !/Usage$/.test(member.metaclass) || member.metaclass === 'MetadataUsage')
		return false;
	const header = readHeader(text, member.from);
	if (!header) return false;
	return header.parts.some((p) => p.slot === 'redefinition' || p.slot === 'value');
}

/** The single operation for `fields`, when the toolkit has one. */
function directOp(header: Header, fields: DeclarationSet, id: string): TkOp | null {
	const keys = Object.entries(fields)
		.filter(([, v]) => v !== undefined)
		.map(([k]) => k);
	if (keys.length !== 1) return null;
	const target = `@${id}`;
	const part = (slot: string) => header.parts.filter((p) => p.slot === slot);
	if (keys[0] === 'type' && fields.type) {
		const typing = part('typing');
		if (typing.length > 1 || (typing[0]?.targets?.length ?? 0) > 1 || typing[0]?.keywordTyping)
			return null;
		return { op: 'setFeatureType', target, type: formatReference(fields.type) };
	}
	if (keys[0] === 'value') {
		if (fields.value?.trim()) return { op: 'setFeatureValue', target, expr: fields.value.trim() };
		return part('value').length ? { op: 'removeFeatureValue', target } : null;
	}
	if (keys[0] === 'redefines' && fields.redefines?.trim()) {
		const redefinition = part('redefinition');
		if (redefinition.length !== 1 || redefinition[0]!.targets?.length !== 1) return null;
		return { op: 'setRedefinedFeature', target, feature: formatReference(fields.redefines) };
	}
	return null;
}

/** Whether a feature takes several values: its multiplicity's upper bound is `*` or above 1. */
function isMany(s: TkSession, feature: TkElement): boolean {
	try {
		const ref = JSON.parse(s.property(feature, 'multiplicity')) as { '@id': string } | null;
		if (!ref) return false;
		const range = s.elementById(ref['@id']);
		if (!range) return false;
		const bounds = s.members(range);
		range.free();
		const upper = bounds.at(-1);
		let many = false;
		if (upper) {
			const metaclass = s.metaclass(upper);
			if (metaclass === 'LiteralInfinity') many = true;
			else if (metaclass === 'LiteralInteger') many = Number(JSON.parse(s.evaluate(upper))) > 1;
		}
		for (const b of bounds) b.free();
		return many;
	} catch {
		return false;
	}
}

/**
 * Member text as the toolkit takes it: without the indentation all its
 * lines share (the toolkit indents it for its owner) or trailing blanks.
 */
function memberText(text: string): string {
	const lines = text.replace(/\r/g, '').replace(/\s+$/, '').split('\n');
	const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
	const common = indents.length ? Math.min(...indents) : 0;
	return lines.map((l) => (l.trim() ? l.slice(common) : '')).join('\n');
}

/** Lines after the first without the member's own indentation (the toolkit adds its owner's). */
function dedent(member: string, indent: string): string {
	if (!indent) return member;
	return member
		.split('\n')
		.map((l, i) => (i > 0 && l.startsWith(indent) ? l.slice(indent.length) : l))
		.join('\n');
}

/** Each change without the text it leaves unchanged at either end. */
function minimize(text: string, changes: TextChange[]): TextChange[] {
	const out: TextChange[] = [];
	for (const c of changes) {
		const insert = c.insert;
		const old = text.slice(c.from, c.to);
		let pre = 0;
		while (pre < old.length && pre < insert.length && old[pre] === insert[pre]) pre++;
		let suf = 0;
		while (
			suf < old.length - pre &&
			suf < insert.length - pre &&
			old[old.length - 1 - suf] === insert[insert.length - 1 - suf]
		)
			suf++;
		const from = c.from + pre;
		const to = c.to - suf;
		const ins = insert.slice(pre, insert.length - suf);
		if (from !== to || ins) out.push({ from, to, insert: ins });
	}
	return out.sort((a, b) => a.from - b.from);
}

export type { Span };
