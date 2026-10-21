/** Just enough XML for spreadsheet files: escaping, entities and attributes. */

/** Characters XML 1.0 cannot hold at all (control characters other than tab and newlines). */
// eslint-disable-next-line no-control-regex
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(text: string): string {
	return text
		.replace(INVALID, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode entities, and OOXML's `_xHHHH_` escapes for characters XML cannot hold. */
export function decodeXml(text: string): string {
	return text
		.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, name: string) => {
			if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
			if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
			return ENTITIES[name] ?? whole;
		})
		.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** `name="value"` pairs of a start tag's attribute text, with prefixes kept (`r:id`). */
export function attributes(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [, name, double, single] of text.matchAll(
		/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
	)) {
		result[name!] = decodeXml(double ?? single ?? '');
	}
	return result;
}
