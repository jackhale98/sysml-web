import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	forgetProject,
	LANDING_REDIRECT,
	LAST_PROJECT_KEY,
	lastProject,
	launchTarget,
	rememberProject
} from './launch.ts';

describe('where the installed app opens', () => {
	it('goes back into the project that was open', () => {
		expect(launchTarget({ launched: true, last: 'drone', stored: ['demo', 'drone'] })).toBe(
			'drone'
		);
	});

	it('stays on the projects page when no project was open, or it is gone', () => {
		expect(launchTarget({ launched: true, last: null, stored: ['drone'] })).toBeNull();
		expect(launchTarget({ launched: true, last: 'deleted', stored: ['drone'] })).toBeNull();
	});

	it('only on launch: visiting the projects page otherwise stays there', () => {
		expect(launchTarget({ launched: false, last: 'drone', stored: ['drone'] })).toBeNull();
	});
});

describe('the last project', () => {
	let stored: Map<string, string>;
	beforeEach(() => {
		stored = new Map();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => stored.get(k) ?? null,
			setItem: (k: string, v: string) => void stored.set(k, v),
			removeItem: (k: string) => void stored.delete(k)
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('is remembered while open and forgotten on the projects page', () => {
		rememberProject('drone');
		expect(stored.get(LAST_PROJECT_KEY)).toBe('drone');
		expect(lastProject()).toBe('drone');
		forgetProject();
		expect(lastProject()).toBeNull();
	});

	it('copes with blocked storage', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		});
		expect(() => rememberProject('drone')).not.toThrow();
		expect(lastProject()).toBeNull();
	});
});

describe('the landing page, opened by an app added before', () => {
	function run(options: { standalone?: boolean; displayMode?: boolean }) {
		const replace = vi.fn();
		new Function('navigator', 'matchMedia', 'location', LANDING_REDIRECT)(
			{ standalone: options.standalone },
			(query: string) => ({
				matches: query === '(display-mode: standalone)' && !!options.displayMode
			}),
			{ replace }
		);
		return replace;
	}

	it('sends the installed app to the projects page, on any platform', () => {
		expect(run({ standalone: true })).toHaveBeenCalledWith('projects?launch');
		expect(run({ displayMode: true })).toHaveBeenCalledWith('projects?launch');
	});

	it('leaves visitors in the browser on the landing page', () => {
		expect(run({})).not.toHaveBeenCalled();
	});
});
