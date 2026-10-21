// SPIKE: try each edit the app's inspector and tables make today through the
// toolkit's Session.edit (or compose it), on a fresh session over the demo.
// Prints, per edit: the ops, ok/refused, time, the splices and the text after.
import { open, demoFiles, time } from './tk-node.mjs';

const files = demoFiles();
const results = [];
function attempt(label, how, build) {
	const s = open(files);
	const units = JSON.parse(s.units());
	const text = (unit) => units.find((u) => u.unit === unit || u.name === unit)?.text;
	let ops;
	try {
		ops = build(s);
		const [raw, ms] = time(() => s.edit(JSON.stringify(ops)));
		const res = JSON.parse(raw);
		const sp = res.splices.map((x) => {
			const before = Buffer.from(text(x.unit) ?? '', 'utf8');
			return {
				unit: x.unit,
				replaced: before.subarray(x.start, x.end).toString('utf8'),
				with: x.text
			};
		});
		const after = JSON.parse(s.check());
		results.push({
			label,
			how,
			ok: true,
			ms,
			ops,
			splices: sp,
			findingsAfter: after.length,
			editFindings: res.findings
		});
	} catch (e) {
		results.push({ label, how, ok: false, ops, error: String(e).slice(0, 300) });
	}
	s.free();
}
const id = (s, q) => s.elementId(s.resolve(q));
/** memberSource keeps the body's absolute indentation and replaceMember indents again: dedent first. */
const dedent = (src) => {
	const lines = src.split('\n');
	const indent = Math.min(
		...lines
			.slice(1)
			.filter((l) => l.trim())
			.map((l) => /^ */.exec(l)[0].length)
	);
	const base = Number.isFinite(indent) ? indent : 0;
	return [
		lines[0],
		...lines.slice(1).map((l) => l.slice(Math.min(base, /^ */.exec(l)[0].length)))
	].join('\n');
};
const firstMember = (s, q, mc) => s.members(s.resolve(q)).find((m) => s.metaclass(m) === mc);

attempt('set usage type', 'setFeatureType', () => [
	{
		op: 'setFeatureType',
		target: 'DroneArchitecture::drone::gnss',
		type: 'DroneComponents::Camera'
	}
]);
attempt('set multiplicity [4] -> [6]', 'memberSource + replaceMember', (s) => {
	const src = s.memberSource('DroneArchitecture::drone::rotors');
	return [
		{
			op: 'replaceMember',
			target: 'DroneArchitecture::drone::rotors',
			text: src.replace('[4]', '[6]')
		}
	];
});
attempt('set direction (port feature in -> inout)', 'memberSource + replaceMember', (s) => {
	const port = s
		.elementsOfMetaclass('PortDefinition')
		.find(
			(p) =>
				!s.isLibraryElement(p) &&
				s.members(p).some((m) => /^(in|out) /.test(s.memberSource('@' + s.elementId(m)) ?? ''))
		);
	const m = s.members(port).find((x) => /^(in|out) /.test(s.memberSource('@' + s.elementId(x))));
	const src = s.memberSource('@' + s.elementId(m));
	return [
		{ op: 'replaceMember', target: '@' + s.elementId(m), text: src.replace(/^(in|out) /, 'inout ') }
	];
});
attempt('set value', 'setFeatureValue', () => [
	{ op: 'setFeatureValue', target: 'DroneComponents::Battery::mass', expr: '1150 [g]' }
]);
attempt('remove value', 'removeFeatureValue', () => [
	{ op: 'removeFeatureValue', target: 'DroneComponents::Battery::mass' }
]);
attempt('set short name (ID) SYS-001 -> SYS-101', 'memberSource + replaceMember', (s) => {
	const q = "SystemRequirements::'Flight endurance'";
	return [
		{
			op: 'replaceMember',
			target: q,
			text: s.memberSource(q).replace("<'SYS-001'>", "<'SYS-101'>")
		}
	];
});
attempt('set doc', 'setCommentBody on the Documentation element', (s) => {
	const doc = firstMember(s, 'DroneComponents::Battery', 'Documentation');
	return [{ op: 'setCommentBody', target: '@' + s.elementId(doc), body: 'A new description.' }];
});
attempt(
	'add specialization + abstract on a definition',
	'memberSource + replaceMember (whole definition)',
	(s) => {
		const q = 'DroneComponents::Camera';
		const src = s.memberSource(q);
		return [
			{
				op: 'replaceMember',
				target: q,
				text: src.replace(
					/^part def Camera( :> Component)?/,
					'abstract part def Camera :> Component, Payload'
				)
			}
		];
	}
);
attempt('insert member into a definition', 'insertMember', () => [
	{
		op: 'insertMember',
		owner: 'DroneComponents::Battery',
		text: 'attribute cellCount : ScalarValues::Integer = 6;'
	}
]);
attempt('insert member into a package', 'insertMember', () => [
	{ op: 'insertMember', owner: 'DroneComponents', text: 'part def Parachute :> Component;' }
]);
attempt('remove element', 'remove', () => [
	{ op: 'remove', target: 'DroneArchitecture::drone::camera' }
]);
attempt('rename across files', 'rename', () => [
	{ op: 'rename', target: 'DroneComponents::Battery', newName: 'PowerPack' }
]);
attempt(
	'enum-valued redefinition (:>> priority = Priority::high -> low)',
	'setFeatureValue',
	() => [
		{
			op: 'setFeatureValue',
			target: "SystemRequirements::'Flight endurance'::priority",
			expr: 'Priority::low'
		}
	]
);
attempt('add enum-valued redefinition where absent', 'insertMember', () => [
	{
		op: 'insertMember',
		owner: "SystemRequirements::'Ingress protection'",
		text: ':>> verificationMethod = VerificationMethod::inspection;'
	}
]);
attempt(
	'metadata field (@StatusInfo { status = … })',
	'setFeatureValue on the metadata feature (by @id)',
	(s) => {
		const md = firstMember(s, "SystemRequirements::'Flight endurance'", 'MetadataUsage');
		const status = s.features(md).find((f) => s.derived(f, 'name') === '"status"');
		return [{ op: 'setFeatureValue', target: '@' + s.elementId(status), expr: 'StatusKind::open' }];
	}
);
attempt('add metadata field (owner absent)', 'insertMember into the metadata usage', (s) => {
	const md = firstMember(s, "SystemRequirements::'Flight endurance'", 'MetadataUsage');
	return [{ op: 'insertMember', owner: '@' + s.elementId(md), text: 'originator = "Ops";' }];
});
attempt('set usage type (no dependent references)', 'setFeatureType', () => [
	{
		op: 'setFeatureType',
		target: 'DroneArchitecture::drone::rotors',
		type: 'DroneComponents::Rotor'
	}
]);
attempt('set short name, dedented', 'memberSource + dedent + replaceMember', (s) => {
	const q = "SystemRequirements::'Flight endurance'";
	return [
		{
			op: 'replaceMember',
			target: q,
			text: dedent(s.memberSource(q)).replace("<'SYS-001'>", "<'SYS-101'>")
		}
	];
});
attempt(
	'abstract + extra specialization, dedented',
	'memberSource + dedent + replaceMember',
	(s) => {
		const q = 'DroneComponents::Camera';
		return [
			{
				op: 'replaceMember',
				target: q,
				text: dedent(s.memberSource(q)).replace(
					/^part def Camera :> Component/,
					'abstract part def Camera :> Component, Airframe'
				)
			}
		];
	}
);
attempt('refused edit (rename that rebinds a reference)', 'rename', () => [
	{ op: 'rename', target: 'DroneComponents::Battery', newName: 'Camera' }
]);
attempt('dry run (checkEdit)', 'checkEdit', (s) => {
	const r = JSON.parse(
		s.checkEdit(
			JSON.stringify([
				{ op: 'setFeatureValue', target: 'DroneComponents::Battery::mass', expr: '1200 [g]' }
			])
		)
	);
	if (!r.wouldCommit) throw new Error(JSON.stringify(r.refusal));
	return [{ op: 'setFeatureValue', target: 'DroneComponents::Battery::mass', expr: '1200 [g]' }];
});
{
	// A real type change on a usage nothing navigates into: insert one, then retype it.
	const s = open(files);
	s.edit(
		JSON.stringify([
			{ op: 'insertMember', owner: 'DroneArchitecture::drone', text: 'part spare : Battery;' }
		])
	);
	const [raw, ms] = time(() =>
		s.edit(
			JSON.stringify([
				{ op: 'setFeatureType', target: 'DroneArchitecture::drone::spare', type: 'Camera' }
			])
		)
	);
	const res = JSON.parse(raw);
	results.push({
		label: 'set usage type Battery -> Camera (after inserting the usage)',
		how: 'setFeatureType',
		ok: true,
		ms,
		splices: res.splices,
		findingsAfter: JSON.parse(s.check()).length,
		typedBy: s.typings(s.resolve('DroneArchitecture::drone::spare')).map((t) => s.qualifiedName(t))
	});
}
console.log(JSON.stringify(results, null, 1));
