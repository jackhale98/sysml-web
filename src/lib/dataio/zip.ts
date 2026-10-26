/**
 * A small ZIP reader and writer for spreadsheets (an `.xlsx` is a ZIP of XML
 * files) and project archives (`.kpar`, or a ZIP of a repository). Deflate
 * uses the platform's `CompressionStream` / `DecompressionStream`
 * (`deflate-raw`), so no compression library ships with the app. No ZIP64,
 * no encryption, no spanning.
 */

export interface ZipEntry {
	/** Path inside the archive, forward slashes. */
	path: string;
	data: Uint8Array;
	/** Read entries only: the data doesn't match the CRC-32 the archive records for it. */
	damaged?: boolean;
}

export interface UnzipOptions {
	/** Most bytes all entries may unpack to; past it, the archive is refused (a ZIP bomb, or simply too big). */
	maxTotal?: number;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** General purpose flag 11: file names are UTF-8. */
const UTF8_NAMES = 0x0800;

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE 802.3), as ZIP stores it. */
export function crc32(data: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
	const output = new Blob([data as BlobPart]).stream().pipeThrough(stream);
	return new Uint8Array(await new Response(output).arrayBuffer());
}

/** Inflate `data`, giving up (null) once the output passes `limit` bytes. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array | null> {
	const reader = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('deflate-raw'))
		.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > limit) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

const megabytes = (n: number) => `${Math.round(n / 1e6).toLocaleString('en')} MB`;

/**
 * Read every file in a ZIP archive (folders are left out). Throws a readable
 * error for anything else; `hint` is added to the "not a ZIP" message. An
 * entry whose data fails its CRC-32 is kept and marked `damaged`.
 */
export async function unzip(
	bytes: Uint8Array,
	hint = '',
	options: UnzipOptions = {}
): Promise<ZipEntry[]> {
	const maxTotal = options.maxTotal ?? Infinity;
	const tooBig = () =>
		new Error(
			`This archive unpacks to more than ${megabytes(maxTotal)}, more than this app opens. It was not opened.`
		);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
		if (view.getUint32(i, true) === END) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new Error(`This is not a ZIP file${hint ? ` (${hint})` : ''}.`);
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	const names = new TextDecoder();
	const entries: ZipEntry[] = [];
	let unpacked = 0;
	for (let i = 0; i < count; i++) {
		if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) {
			throw new Error('The ZIP file is damaged.');
		}
		const method = view.getUint16(at + 10, true);
		const crc = view.getUint32(at + 16, true);
		const compressed = view.getUint32(at + 20, true);
		const size = view.getUint32(at + 24, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		const local = view.getUint32(at + 42, true);
		const path = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + extraLength + commentLength;
		if (path.endsWith('/')) continue;
		if (view.getUint32(local, true) !== LOCAL) throw new Error('The ZIP file is damaged.');
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const raw = bytes.subarray(start, start + compressed);
		// What the archive says it unpacks to is checked first; the inflating itself is capped too.
		if (unpacked + size > maxTotal) throw tooBig();
		let data: Uint8Array;
		if (method === 0) data = raw.slice();
		else if (method === 8) {
			const inflated = await inflate(raw, maxTotal - unpacked);
			if (!inflated) throw tooBig();
			data = inflated;
		} else throw new Error(`${path} uses a ZIP compression this app cannot read.`);
		unpacked += data.length;
		if (unpacked > maxTotal) throw tooBig();
		entries.push(crc32(data) === crc ? { path, data } : { path, data, damaged: true });
	}
	return entries;
}

/**
 * Write a ZIP archive, deflating each file (or, with `store`, keeping every
 * file as it is, as `.kpar` writers do). Times are the DOS epoch, so the same
 * content always gives the same bytes.
 */
export async function zip(
	entries: { path: string; data: Uint8Array | string }[],
	options: { store?: boolean } = {}
) {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	// 1980-01-01 00:00, the DOS epoch: the archive is the same for the same content.
	const time = 0;
	const date = (0 << 9) | (1 << 5) | 1;
	for (const entry of entries) {
		const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
		const name = encoder.encode(entry.path);
		const deflated = options.store
			? data
			: await transform(data, new CompressionStream('deflate-raw'));
		const stored = options.store || deflated.length >= data.length;
		const body = stored ? data : deflated;
		const crc = crc32(data);

		const local = new Uint8Array(30 + name.length);
		const l = new DataView(local.buffer);
		l.setUint32(0, LOCAL, true);
		l.setUint16(4, 20, true);
		l.setUint16(6, UTF8_NAMES, true);
		l.setUint16(8, stored ? 0 : 8, true);
		l.setUint16(10, time, true);
		l.setUint16(12, date, true);
		l.setUint32(14, crc, true);
		l.setUint32(18, body.length, true);
		l.setUint32(22, data.length, true);
		l.setUint16(26, name.length, true);
		local.set(name, 30);

		const header = new Uint8Array(46 + name.length);
		const c = new DataView(header.buffer);
		c.setUint32(0, CENTRAL, true);
		c.setUint16(4, 20, true);
		c.setUint16(6, 20, true);
		c.setUint16(8, UTF8_NAMES, true);
		c.setUint16(10, stored ? 0 : 8, true);
		c.setUint16(12, time, true);
		c.setUint16(14, date, true);
		c.setUint32(16, crc, true);
		c.setUint32(20, body.length, true);
		c.setUint32(24, data.length, true);
		c.setUint16(28, name.length, true);
		c.setUint32(42, offset, true);
		header.set(name, 46);

		parts.push(local, body);
		central.push(header);
		offset += local.length + body.length;
	}
	const centralSize = central.reduce((n, h) => n + h.length, 0);
	const end = new Uint8Array(22);
	const e = new DataView(end.buffer);
	e.setUint32(0, END, true);
	e.setUint16(8, entries.length, true);
	e.setUint16(10, entries.length, true);
	e.setUint32(12, centralSize, true);
	e.setUint32(16, offset, true);

	const all = [...parts, ...central, end];
	const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of all) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
