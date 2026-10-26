/**
 * Assessment (§2, save/reload fidelity): the bytes of a model file read
 * from disk (`readUploadedFolder`, the same `File.text()` a picked folder
 * uses) and written back (`writeToFolder`, a string written as UTF-8, as
 * File System Access does) are the bytes that were there, for the shapes
 * model files come in: Unix and Windows line endings, tabs, trailing
 * spaces, no final newline, non-ASCII text, a byte-order mark, and a file
 * that is not UTF-8. Only unchanged files are compared: the round trip
 * should not alter a file the person did not edit.
 */
import { describe, expect, it } from 'vitest';
import { readFolder, readUploadedFolder, refusedNote, writeToFolder } from './sources.ts';

/** An in-memory folder: what the app writes, as the bytes a browser would store. */
class Folder {
	readonly kind = 'directory';
	files = new Map<string, Uint8Array>();
	constructor(readonly name = 'Rig') {}
	async *values() {
		for (const [name, data] of this.files)
			yield { kind: 'file', name, getFile: async () => new File([data as BlobPart], name) };
	}
	async getDirectoryHandle() {
		return this;
	}
	async getFileHandle(name: string) {
		const files = this.files;
		return {
			kind: 'file',
			name,
			async createWritable() {
				let data = new Uint8Array();
				return {
					async write(text: string) {
						data = new TextEncoder().encode(text);
					},
					async close() {
						files.set(name, data);
					}
				};
			}
		};
	}
	async removeEntry() {}
	async queryPermission() {
		return 'granted' as const;
	}
}

/** Read bytes as the app reads an uploaded folder's file, then write the text back. */
async function roundTrip(bytes: Uint8Array): Promise<{ text: string; written: Uint8Array }> {
	const file = new File([bytes as BlobPart], 'Model.sysml');
	Object.defineProperty(file, 'webkitRelativePath', { value: 'Rig/model/Model.sysml' });
	const { files } = await readUploadedFolder([file] as unknown as FileList);
	expect(files.map((f) => f.path)).toEqual(['model/Model.sysml']);
	const text = files[0]!.text;
	const folder = new Folder();
	await writeToFolder(folder as unknown as FileSystemDirectoryHandle, [
		{ path: 'Model.sysml', text }
	]);
	return { text, written: folder.files.get('Model.sysml')! };
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const MODEL = 'package P {\n\tpart def A;   \n    doc /* µ Ω ✓ “quoted” 😀 */\n}';

describe('reading and writing a model file keeps its bytes', () => {
	it.each([
		['Unix line endings, tabs, trailing spaces, non-ASCII, no final newline', MODEL],
		['Windows line endings', MODEL.replace(/\n/g, '\r\n') + '\r\n'],
		['mixed line endings and a lone carriage return', 'package P {\r\n\tpart a;\n\r}\n']
	])('%s', async (_, model) => {
		const bytes = utf8(model);
		const { text, written } = await roundTrip(bytes);
		expect(text).toBe(model);
		expect([...written]).toEqual([...bytes]);
	});

	it('a UTF-8 file with a byte-order mark', async () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(MODEL)]);
		const { written } = await roundTrip(bytes);
		expect([...written]).toEqual([...bytes]);
	});

	// Read as UTF-8, its bytes would become U+FFFD and be written back so: it is left out, and named.
	const LATIN1 = new Uint8Array([...utf8('package P { doc /* '), 0xb5, ...utf8(' */ }\n')]);

	it('a file that is not UTF-8 is refused, and named', async () => {
		const file = new File([LATIN1 as BlobPart], 'Model.sysml');
		Object.defineProperty(file, 'webkitRelativePath', { value: 'Rig/model/Model.sysml' });
		const other = new File([utf8(MODEL) as BlobPart], 'Other.sysml');
		Object.defineProperty(other, 'webkitRelativePath', { value: 'Rig/model/Other.sysml' });
		const { files, refused } = await readUploadedFolder([file, other] as unknown as FileList);
		expect(files.map((f) => f.path)).toEqual(['model/Other.sysml']);
		expect(refused).toEqual(['model/Model.sysml']);
		expect(refusedNote(refused)).toBe(
			"“model/Model.sysml” wasn't opened: it isn't UTF-8 text. Save it as UTF-8 and open the folder again."
		);
	});

	it('a save does not write over a file there that is not UTF-8', async () => {
		const folder = new Folder();
		folder.files.set('Model.sysml', LATIN1);
		folder.files.set('Other.sysml', utf8(MODEL));
		const handle = folder as unknown as FileSystemDirectoryHandle;
		// Not one of the project's files: left out, as when the folder was opened.
		expect(await readFolder(handle, ['Other.sysml'])).toEqual({ 'Other.sysml': MODEL });
		// One the project has (made here since): refused, with its name.
		await expect(readFolder(handle, ['Model.sysml', 'Other.sysml'])).rejects.toThrow(
			/“Model\.sysml” in the folder isn't UTF-8 text, so nothing was saved/
		);
		expect([...folder.files.get('Model.sysml')!]).toEqual([...LATIN1]);
	});
});
