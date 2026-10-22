/**
 * What review mode marks in diagrams and tables: elements added or changed
 * since the version being compared with, and those removed (listed, not
 * drawn). Kept apart from the review itself (`review.svelte.ts`) so the
 * views that show marks don't load the diff and its wording.
 */
import type { ModelDiff } from './types';

export type ReviewMark = 'added' | 'changed';

export interface RemovedElement {
	label: string;
	kind: string;
	qualifiedName: string;
	owner: string | null;
}

/** How a mark reads, for the badge and for screen readers (never colour alone). */
export const MARK_WORDS: Record<ReviewMark, { badge: string; said: string }> = {
	added: { badge: 'New', said: 'added in this review' },
	changed: { badge: 'Changed', said: 'changed in this review' }
};

class ReviewMarks {
	/** A review is open (its marks can show). */
	active = $state(false);
	/** The person's choice to show them. */
	visible = $state(true);
	/** By element id (in the version on screen). */
	byId = $state.raw<ReadonlyMap<string, ReviewMark>>(new Map());
	removed = $state.raw<RemovedElement[]>([]);
	/** What the review compares with, briefly (`the version on GitHub`). */
	against = $state('');
	/** Set by the review, so leaving review mode from a view (or closing it) stops it too. */
	onEnd: (() => void) | null = null;

	get shown(): boolean {
		return this.active && this.visible;
	}

	markOf(id: string | undefined | null): ReviewMark | null {
		return this.shown && id ? (this.byId.get(id) ?? null) : null;
	}

	/** Mark what a comparison found: the elements, and the owners of what changed in them. */
	set(diff: ModelDiff, against: string) {
		// Built here, then stored whole (`$state.raw`): not reactive themselves.
		/* eslint-disable svelte/prefer-svelte-reactivity */
		const marks = new Map<string, ReviewMark>();
		const owners = new Set<string>();
		/* eslint-enable svelte/prefer-svelte-reactivity */
		for (const c of diff.elements) {
			if (!c.after) continue;
			marks.set(c.after.id, c.change === 'added' ? 'added' : 'changed');
			// A feature drawn in its owner's compartment marks the owner too.
			if (c.after.ownerId) owners.add(c.after.ownerId);
		}
		for (const r of diff.relations) if (r.ownerId) owners.add(r.ownerId);
		for (const id of owners) if (!marks.has(id)) marks.set(id, 'changed');
		this.byId = marks;
		this.removed = diff.elements
			.filter((c) => c.change === 'removed' && c.before)
			.map((c) => ({
				label: c.before!.label,
				kind: c.kind,
				qualifiedName: c.before!.qualifiedName,
				owner: c.before!.owner
			}));
		this.against = against;
		this.active = true;
	}

	/** Leave review mode. */
	end() {
		if (this.onEnd) this.onEnd();
		else this.clear();
	}

	clear() {
		this.active = false;
		this.byId = new Map();
		this.removed = [];
		this.against = '';
	}
}

export const reviewMarks = new ReviewMarks();
