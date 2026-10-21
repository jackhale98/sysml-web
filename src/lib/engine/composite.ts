/**
 * One engine for the app, from two: the sysml-toolkit for every method ported
 * to it (`TOOLKIT_METHODS`), the classic engine for the rest until their
 * phase lands (docs/engine.md). Each phase moves methods into the toolkit's
 * list; when the list covers `EngineApi`, the classic engine goes.
 */
import type { ClassicEngine, Engine } from './client';
import type { Method, RetiredMethod } from './protocol';
import type { ToolkitClient } from './toolkit/client';
import { TOOLKIT_METHODS, type ToolkitMethod } from './toolkit/protocol';

const ROUTED = new Set<Method>(TOOLKIT_METHODS);

/** A method deleted from the classic engine must be routed to the toolkit. */
const retiredAreRouted: [Exclude<RetiredMethod, ToolkitMethod>] extends [never] ? true : never =
	true;
void retiredAreRouted;

export function composeEngine(classic: ClassicEngine, toolkit: ToolkitClient): Engine {
	const engine: Record<string, unknown> = { ...classic };
	for (const method of ROUTED) {
		engine[method] = (...params: never[]) =>
			toolkit.call(method as ToolkitMethod, ...(params as []));
	}
	engine.terminate = () => {
		classic.terminate();
		toolkit.terminate();
	};
	return engine as Engine;
}
