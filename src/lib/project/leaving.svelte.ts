/**
 * Leaving the open project (switching to another, going to all projects,
 * opening a new one) without losing track of work. Everything is kept on
 * this device either way; when changes aren't on GitHub or in the folder
 * yet, a calm dialog says so first and offers to save them.
 *
 * The project page registers its session; the project menu shows the
 * dialog (`prompt`) and says how to open the GitHub sheet (`saveToGitHub`).
 */
import { toasts } from '#lib/ui/toasts.svelte.ts';
import type { LeaveRisk } from './pending.ts';
import type { ProjectSession } from './session.svelte.ts';

/** Switching straight to another project, or leaving for another page. */
export type LeaveAction = 'switch' | 'leave';

export type LeaveChoice = 'save-github' | 'save-folder' | 'retry' | 'anyway' | 'cancel';

export interface LeavePrompt {
	risk: LeaveRisk;
	action: LeaveAction;
	/** The open project's name. */
	name: string;
	answer: (choice: LeaveChoice) => void;
}

class Leaving {
	/** The open project, while its page is shown. */
	session = $state.raw<ProjectSession | null>(null);
	/** The question on screen, if any. */
	prompt = $state.raw<LeavePrompt | null>(null);
	/** Opens the project's GitHub sheet (set by whoever can show it). */
	saveToGitHub: (() => void) | null = null;

	/** The project page's session; returns a function that forgets it. */
	register(session: ProjectSession): () => void {
		this.session = session;
		return () => {
			if (this.session === session) this.session = null;
		};
	}

	/** What leaving now would leave behind (without saving first). */
	get risk(): LeaveRisk | null {
		return this.session?.leaveRisk ?? null;
	}

	private ask(risk: LeaveRisk, action: LeaveAction): Promise<LeaveChoice> {
		this.prompt?.answer('cancel');
		return new Promise((resolve) => {
			this.prompt = {
				risk,
				action,
				name: this.session?.record?.info.name ?? 'This project',
				answer: (choice) => {
					this.prompt = null;
					resolve(choice);
				}
			};
		});
	}

	/**
	 * Before leaving the open project: save what is waiting to be saved in
	 * this browser, then, if changes aren't on GitHub or in the folder yet,
	 * ask. True to go ahead.
	 */
	async confirm(action: LeaveAction): Promise<boolean> {
		const session = this.session;
		if (!session) return true;
		await session.flush();
		for (;;) {
			const risk = session.leaveRisk;
			if (!risk) return true;
			const choice = await this.ask(risk, action);
			if (choice === 'anyway') return true;
			if (choice === 'cancel') return false;
			if (choice === 'save-github') {
				this.saveToGitHub?.();
				return false;
			}
			if (choice === 'retry') {
				await session.save();
				continue;
			}
			// Save to the folder, then go on.
			const error = await session.saveToFolder();
			if (error) {
				toasts.show(error, { tone: 'error' });
				return false;
			}
			toasts.show('Saved to the folder.', { tone: 'success' });
			return true;
		}
	}
}

export const leaving = new Leaving();
