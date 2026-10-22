/**
 * For unit tests: element JSON checked against the OMG's JSON schema for
 * SysML 2.0 (`fixtures/SysML-20250201.schema.json.gz`, a gzipped copy of
 * https://www.omg.org/spec/SysML/20250201/SysML.json, sha256
 * bb0d8af159cf2cbe4a0df4ed6b903505a57e33d047068e5a50a7008a18d546c5).
 *
 * The schema uses a small part of JSON Schema 2020-12 (`$ref` by `$id`,
 * `anyOf`, `oneOf`, `type`, `const`, `enum`, `properties`, `required`,
 * `additionalProperties: false`, `items`, `minItems`, `maxItems`), which this
 * validates; `format` is an annotation and is not asserted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ElementJson } from './elements';

type Schema = Record<string, unknown>;

let defs: Map<string, Schema> | undefined;
let byName: Map<string, Schema> | undefined;

function load() {
	if (defs && byName) return { defs, byName };
	const file = join(import.meta.dirname, 'fixtures/SysML-20250201.schema.json.gz');
	const root = JSON.parse(gunzipSync(readFileSync(file)).toString()) as {
		$defs: Record<string, Schema>;
	};
	defs = new Map(Object.values(root.$defs).map((d) => [d.$id as string, d]));
	byName = new Map(Object.entries(root.$defs));
	return { defs, byName };
}

const typeOf = (value: unknown): string =>
	value === null
		? 'null'
		: Array.isArray(value)
			? 'array'
			: typeof value === 'number'
				? Number.isInteger(value)
					? 'integer'
					: 'number'
				: typeof value;

/** Errors of `value` against `schema`, as `path: message`. */
function validate(value: unknown, schema: Schema, path: string, errors: string[]): void {
	const { defs } = load();
	if (typeof schema.$ref === 'string') {
		const target = defs.get(schema.$ref);
		if (!target) errors.push(`${path}: unknown $ref ${schema.$ref}`);
		else validate(value, target, path, errors);
	}
	if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
		const options = (schema.anyOf ?? schema.oneOf) as Schema[];
		const passing = options.filter((option) => {
			const inner: string[] = [];
			validate(value, option, path, inner);
			return inner.length === 0;
		}).length;
		if (schema.oneOf ? passing !== 1 : passing === 0)
			errors.push(`${path}: matches ${passing} of the ${schema.oneOf ? 'oneOf' : 'anyOf'} options`);
	}
	if (typeof schema.type === 'string') {
		const actual = typeOf(value);
		const ok = schema.type === actual || (schema.type === 'number' && actual === 'integer');
		if (!ok) {
			errors.push(`${path}: is ${actual}, not ${schema.type}`);
			return;
		}
	}
	if ('const' in schema && value !== schema.const)
		errors.push(`${path}: is ${JSON.stringify(value)}, not ${JSON.stringify(schema.const)}`);
	if (Array.isArray(schema.enum) && !schema.enum.includes(value))
		errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
	if (Array.isArray(value)) {
		if (typeof schema.minItems === 'number' && value.length < schema.minItems)
			errors.push(`${path}: fewer than ${schema.minItems} items`);
		if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
			errors.push(`${path}: more than ${schema.maxItems} items`);
		if (schema.items)
			value.forEach((item, i) => validate(item, schema.items as Schema, `${path}[${i}]`, errors));
	}
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const object = value as Record<string, unknown>;
		const properties = (schema.properties ?? {}) as Record<string, Schema>;
		for (const name of (schema.required as string[] | undefined) ?? [])
			if (!(name in object)) errors.push(`${path}: lacks required ${name}`);
		for (const [name, v] of Object.entries(object)) {
			if (properties[name]) validate(v, properties[name], `${path}.${name}`, errors);
			else if (schema.additionalProperties === false && schema.properties)
				errors.push(`${path}: has unknown property ${name}`);
		}
	}
}

/**
 * Errors of each element against the schema of its `@type`. `full`: every
 * property the schema requires must be there (the form with derived
 * properties); otherwise only `@id` and `@type` are required and every
 * property present must be one the type has, with a valid value.
 */
export function schemaErrors(elements: readonly ElementJson[], full: boolean): string[] {
	const { byName } = load();
	const errors: string[] = [];
	for (const e of elements) {
		const definition = byName.get(e['@type']);
		if (!definition) {
			errors.push(`${e['@id']}: unknown @type ${e['@type']}`);
			continue;
		}
		// The first option is the type itself; the rest are its subtypes.
		const own = ((definition.anyOf as Schema[] | undefined)?.[0] ?? definition) as Schema;
		const schema = full ? own : { ...own, required: ['@id', '@type'] };
		validate(e, schema, `${e['@type']} ${e['@id']}`, errors);
	}
	return errors;
}
