/** Plain-language labels and tones for `ModelingMetadata::StatusKind`. */

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

const STATUS: Record<string, { label: string; tone: Tone }> = {
	open: { label: 'Open', tone: 'info' },
	tbd: { label: 'To be defined', tone: 'warn' },
	tbr: { label: 'To be reviewed', tone: 'warn' },
	tbc: { label: 'To be confirmed', tone: 'warn' },
	done: { label: 'Done', tone: 'ok' },
	closed: { label: 'Closed', tone: 'muted' }
};

export function statusLabel(status: string | null): { label: string; tone: Tone } {
	if (!status) return { label: 'No status', tone: 'muted' };
	return STATUS[status] ?? { label: humanize(status), tone: 'muted' };
}

/** `verificationMethod` → `Verification method`, `performance` → `Performance`. */
export function humanize(value: string): string {
	const spaced = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
