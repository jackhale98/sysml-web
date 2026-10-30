/**
 * Showing a product configuration (`docs/variants.md`): which one is chosen,
 * whether it applies to what a table or diagram shows, and how its choices
 * read.
 */
import type { Variability, VariabilityConfiguration } from '#lib/engine/types.ts';

/** The chosen configuration, while the model still has it. */
export function chosenConfiguration(
	variability: Variability,
	name: string | null
): VariabilityConfiguration | null {
	if (!name) return null;
	return variability.configurations.find((c) => c.qualifiedName === name) ?? null;
}

/**
 * Whether showing a configuration can change a diagram: it draws elements
 * from a file the configuration's choices are made in (null: not known yet).
 */
export function changesDrawing(
	variability: Variability,
	drawnFiles: readonly string[] | null
): boolean {
	if (!variability.configurations.length) return false;
	if (drawnFiles === null) return true;
	const drawn = new Set(drawnFiles);
	return variability.configurations.some((c) => c.changes.some((f) => drawn.has(f)));
}

/** "battery: longRangePack, radio: longRangeRadio" (a choice not made is shown as written). */
export function describeChoices(configuration: VariabilityConfiguration): string {
	return configuration.choices
		.map((c) => `${c.point}: ${c.variant && !c.problem ? c.variant : 'as written'}`)
		.join(', ');
}
