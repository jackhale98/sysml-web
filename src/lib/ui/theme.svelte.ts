/** Light / dark / system theme, remembered per browser. */

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'sysml-web:theme';

function read(): ThemeChoice {
	try {
		const value = localStorage.getItem(KEY);
		return value === 'light' || value === 'dark' ? value : 'system';
	} catch {
		return 'system';
	}
}

class Theme {
	choice = $state<ThemeChoice>('system');

	init() {
		this.choice = read();
		this.apply();
	}

	set(choice: ThemeChoice) {
		this.choice = choice;
		try {
			if (choice === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, choice);
		} catch {
			// Storage can be unavailable (private mode); the choice still applies.
		}
		this.apply();
	}

	/** Cycle system → light → dark. */
	next() {
		this.set(this.choice === 'system' ? 'light' : this.choice === 'light' ? 'dark' : 'system');
	}

	private apply() {
		const root = document.documentElement;
		if (this.choice === 'system') delete root.dataset.theme;
		else root.dataset.theme = this.choice;
	}
}

export const theme = new Theme();
