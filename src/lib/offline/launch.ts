/**
 * Where the installed app opens. Launched from the Home Screen, it goes
 * back into the project that was open last time, or else to "Your
 * projects": never the landing page, which is for visitors.
 *
 * - The manifest's `start_url` is the projects page with `?launch`; that
 *   page reopens the last project (`launchTarget`).
 * - Apps added before that still start at the site root; the landing page
 *   sends them on when it is running as the installed app (`LANDING_REDIRECT`).
 */

/** The project open last (its id), while it stays open. */
export const LAST_PROJECT_KEY = 'sysml-web:last-project';
/** Added to the projects page's address when the installed app starts. */
export const LAUNCH_PARAM = 'launch';

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** Remember the project that is open, to come back to it next launch. */
export function rememberProject(id: string) {
	try {
		storage()?.setItem(LAST_PROJECT_KEY, id);
	} catch {
		// Blocked: the app opens on the projects page instead.
	}
}

/** No project is open any more (the person went to the projects page). */
export function forgetProject() {
	try {
		storage()?.removeItem(LAST_PROJECT_KEY);
	} catch {
		// Blocked.
	}
}

export function lastProject(): string | null {
	try {
		return storage()?.getItem(LAST_PROJECT_KEY) ?? null;
	} catch {
		return null;
	}
}

/**
 * The project to reopen when the projects page loads: only when the app was
 * just launched, and only a project still kept here. Null to stay on the
 * projects page.
 */
export function launchTarget(options: {
	/** The page was opened by launching the app (`?launch`). */
	launched: boolean;
	last: string | null;
	/** Ids of the projects kept here. */
	stored: readonly string[];
}): string | null {
	if (!options.launched || !options.last) return null;
	return options.stored.includes(options.last) ? options.last : null;
}

/**
 * Run first thing on the prerendered landing page (before it paints): the
 * installed app goes to the projects page. The landing page is always at
 * the site root, so the relative address works under any base path.
 */
export const LANDING_REDIRECT = `(function () {
	try {
		var installed =
			navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
		if (installed) location.replace('projects?${LAUNCH_PARAM}');
	} catch (e) {}
})();`;
