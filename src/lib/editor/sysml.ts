/**
 * CodeMirror support for SysML v2, driven by the engine: highlighting comes
 * from the grammar's highlight query (computed in the engine worker) and
 * diagnostics from the engine's analysis.
 */
import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Highlights } from '#lib/engine/types.ts';

const setHighlights = StateEffect.define<DecorationSet>();

const highlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, tr) {
		for (const effect of tr.effects) if (effect.is(setHighlights)) return effect.value;
		return decorations.map(tr.changes);
	},
	provide: (field) => EditorView.decorations.from(field)
});

const marks = new Map<string, Decoration>();

function mark(name: string): Decoration {
	let decoration = marks.get(name);
	if (!decoration) {
		decoration = Decoration.mark({ class: `tok-${name.replace(/\./g, '-')}` });
		marks.set(name, decoration);
	}
	return decoration;
}

/** Highlighting state; update it with {@link highlightEffect}. */
export function sysmlHighlighting(): Extension {
	return [highlightField, highlightTheme];
}

/** An effect that replaces the highlighting with the engine's result. */
export function highlightEffect(highlights: Highlights, docLength: number) {
	const ranges: Range<Decoration>[] = [];
	const { names, spans } = highlights;
	for (let i = 0; i + 2 < spans.length; i += 3) {
		const from = spans[i] ?? 0;
		const to = Math.min(spans[i + 1] ?? 0, docLength);
		const name = names[spans[i + 2] ?? -1];
		if (!name || from >= to || name.startsWith('punctuation')) continue;
		ranges.push(mark(name).range(from, to));
	}
	return setHighlights.of(Decoration.set(ranges, true));
}

/** Token colours, from the app's design tokens. */
const highlightTheme = EditorView.baseTheme({
	'.tok-keyword, .tok-keyword-modifier, .tok-keyword-operator': {
		color: 'var(--syntax-keyword)',
		fontWeight: '550'
	},
	'.tok-type-definition': { color: 'var(--syntax-definition)', fontWeight: '600' },
	'.tok-type': { color: 'var(--syntax-type)' },
	'.tok-variable': { color: 'var(--syntax-name)' },
	'.tok-module': { color: 'var(--syntax-module)', fontWeight: '600' },
	'.tok-comment': { color: 'var(--syntax-comment)', fontStyle: 'italic' },
	'.tok-comment-documentation': { color: 'var(--syntax-doc)' },
	'.tok-string': { color: 'var(--syntax-string)' },
	'.tok-number, .tok-constant-builtin': { color: 'var(--syntax-number)' },
	'.tok-attribute': { color: 'var(--syntax-attribute)' },
	'.tok-operator': { color: 'var(--syntax-operator)' }
});

/** Editor chrome using the app's design tokens. */
export const editorTheme = EditorView.theme({
	'&': {
		height: '100%',
		fontSize: '13.5px',
		backgroundColor: 'var(--surface)',
		color: 'var(--text)'
	},
	'.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
	'.cm-content': { caretColor: 'var(--accent)', padding: '12px 0' },
	'.cm-gutters': {
		backgroundColor: 'var(--surface)',
		color: 'var(--text-3)',
		border: 'none',
		paddingLeft: '8px'
	},
	'.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent-weak) 45%, transparent)' },
	'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-2)' },
	'.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
		backgroundColor: 'var(--accent-weak) !important'
	},
	'.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
	'.cm-matchingBracket': {
		backgroundColor: 'var(--accent-weak)',
		outline: '1px solid var(--accent)'
	},
	'.cm-tooltip': {
		backgroundColor: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: '8px',
		boxShadow: 'var(--shadow-md)'
	},
	'.cm-diagnostic': { fontFamily: 'var(--font-ui)', padding: '6px 10px' },
	'.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
	'.cm-reveal': { backgroundColor: 'var(--warn-weak)', transition: 'background 600ms' }
});
