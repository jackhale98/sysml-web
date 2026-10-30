/**
 * Adding to a use case diagram: a use case, written beside the use cases
 * already drawn (with the same subject, so it lands in the same boundary),
 * and an actor taking part in a use case (its `actor` parameter, and the
 * part def it is typed by when there is none of that name yet).
 *
 * Pure, like `relationships.ts`: the steps come back for `applySteps`.
 */
import type { ModelElement } from '#lib/project/elements.ts';
import { formatName } from '#lib/workbench/templates.ts';
import { isVisible, qualifiedName, referenceFrom } from './model.ts';
import {
	besideStep,
	memberNames,
	partName,
	type ModelContext,
	type Plan
} from './relationships.ts';
import { simpleName } from './textpatch.ts';

const isLibrary = (e: ModelElement) => e.file.startsWith('libraries/');
export const isUseCase = (e: ModelElement) => e.kind === 'use_case' || e.kind === 'use case';

/**
 * Where a new use case goes, and the use case it follows: next to `near`
 * (the selected one), else the last use case drawn that is written in a
 * package (or a part), else in `fallback` (the package the view shows).
 */
export function useCaseHost(
	drawn: readonly ModelElement[],
	near: ModelElement | undefined,
	fallback: ModelElement | undefined,
	ctx: ModelContext
): { host: ModelElement; like?: ModelElement } | null {
	const own = drawn.filter((e) => isUseCase(e) && !isLibrary(e));
	const like =
		(near && own.find((e) => e.key === near.key)) ??
		[...own].reverse().find((e) => {
			const owner = ctx.owners.get(e.key);
			return !!owner && !isUseCase(owner);
		});
	const host = like ? ctx.owners.get(like.key) : fallback;
	if (!host || isLibrary(host) || isUseCase(host)) return null;
	return like ? { host, like } : { host };
}

/**
 * `use case def Name { subject drone : DeliveryDrone; }` in a package, with
 * the subject of the use case it follows; `use case name;` in a part, whose
 * use case it is.
 */
export function planAddUseCase(
	name: string,
	place: { host: ModelElement; like?: ModelElement },
	ctx: ModelContext
): Plan | string {
	const written = formatName(name.trim());
	if (!name.trim()) return 'Give the use case a name.';
	const { host, like } = place;
	if (memberNames(host, ctx).includes(written))
		return `${host.label} already has something called ${name.trim()}.`;
	let statement: string;
	if (host.kind === 'package') {
		const subject = like
			? ctx.elements.find((e) => e.kind === 'subject' && ctx.owners.get(e.key)?.key === like.key)
			: undefined;
		statement =
			subject?.typeRef && like?.isDefinition
				? `use case def ${written} {\n    subject ${subject.name} : ${subject.typeRef};\n}`
				: `use case def ${written};`;
	} else statement = `use case ${written};`;
	const text = ctx.textOf(host.file);
	if (text === undefined) return `${host.file} is not in the project.`;
	return {
		label: `Added the use case ${name.trim()} to ${host.label}`,
		statement,
		steps: [{ kind: 'member', path: host.file, parent: host, text: statement }]
	};
}

/**
 * An actor of `useCase`: `actor customer : Customer;` beside its other
 * actors. A part def of that name is used when there is one; else it is
 * written too, beside the part defs of the actors drawn (else in the use
 * case's package).
 */
export function planAddActor(
	name: string,
	useCase: ModelElement,
	actorDefs: readonly ModelElement[],
	ctx: ModelContext
): Plan | string {
	const typeName = formatName(name.trim());
	if (!name.trim()) return 'Give the actor a name.';
	if (isLibrary(useCase)) return `${useCase.label} is in a library; it cannot change.`;
	const existing = ctx.elements.find(
		(e) => e.isDefinition && e.kind === 'part' && e.name === typeName && !isLibrary(e)
	);
	let home = ctx.owners.get(useCase.key);
	while (home && home.kind !== 'package') home = ctx.owners.get(home.key);
	const pkg = existing
		? undefined
		: (actorDefs.map((d) => ctx.owners.get(d.key)).find((p) => p && !isLibrary(p)) ?? home);
	if (!existing && !pkg) return `There is no package to write ${name.trim()} in.`;
	if (pkg && memberNames(pkg, ctx).includes(typeName))
		return `${pkg.label} already has something called ${name.trim()}.`;
	const type = existing
		? referenceFrom(existing, useCase, ctx.owners, ctx.textOf)
		: isVisible(
					`${qualifiedName(pkg!, ctx.owners)}::${typeName}`,
					qualifiedName(useCase, ctx.owners),
					ctx.textOf(useCase.file)
			  )
			? typeName
			: `${qualifiedName(pkg!, ctx.owners)}::${typeName}`;
	if (
		ctx.elements.some(
			(e) =>
				e.kind === 'actor' &&
				ctx.owners.get(e.key)?.key === useCase.key &&
				simpleName(e.typeRef ?? '') === simpleName(typeName)
		)
	)
		return `${name.trim()} already takes part in ${useCase.label}.`;
	const statement = `actor ${partName(typeName, memberNames(useCase, ctx))} : ${type};`;
	const param = besideStep(useCase, 'actor', statement, ctx);
	if (typeof param === 'string') return param;
	const definition = pkg ? `part def ${typeName};` : null;
	return {
		label: `${name.trim()} now takes part in ${useCase.label}`,
		statement: definition ? `${definition}\n${statement}` : statement,
		// The parameter first: the def goes to the end of its package, after it in the same file.
		steps: [
			param,
			...(pkg && definition
				? [{ kind: 'member' as const, path: pkg.file, parent: pkg, text: definition }]
				: [])
		]
	};
}
