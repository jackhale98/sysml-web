/**
 * The documentation's own links resolve, and the docs index lists every doc.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const DOCS = join(ROOT, 'docs');

function markdownFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return markdownFiles(path);
		return name.endsWith('.md') ? [path] : [];
	});
}

/** Relative link targets in a Markdown file, without their #anchor. */
function relativeLinks(file: string): string[] {
	const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
	return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
		.map((m) => m[1]!)
		.filter((target) => !/^[a-z]+:/i.test(target) && !target.startsWith('#'))
		.map((target) => target.split('#')[0]!);
}

const files = [join(ROOT, 'README.md'), ...markdownFiles(DOCS)];

describe('the documentation', () => {
	it.each(files.map((f) => [relative(ROOT, f), f]))(
		'%s links only to files that exist',
		(_, file) => {
			const broken = relativeLinks(file).filter(
				(target) => !existsSync(join(dirname(file), target))
			);
			expect(broken).toEqual([]);
		}
	);

	it('lists every doc in its index, and in the README', () => {
		const index = relativeLinks(join(DOCS, 'README.md')).map((t) => resolve(DOCS, t));
		const readme = relativeLinks(join(ROOT, 'README.md')).map((t) => resolve(ROOT, t));
		for (const doc of markdownFiles(DOCS).filter((f) => f !== join(DOCS, 'README.md'))) {
			expect(index, relative(ROOT, doc)).toContain(doc);
			expect(readme, relative(ROOT, doc)).toContain(doc);
		}
	});
});
