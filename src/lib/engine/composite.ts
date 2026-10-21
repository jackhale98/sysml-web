/**
 * One engine for the app, from two: the sysml-toolkit for every method ported
 * to it (`TOOLKIT_METHODS`), the classic engine for the rest until their
 * phase lands (docs/engine.md). Each phase moves methods into the toolkit's
 * list; when the list covers `EngineApi`, the classic engine goes.
 */
import type { Engine } from './client';
import type { Method } from './protocol';
import type { ToolkitClient } from './toolkit/client';
import { TOOLKIT_METHODS, type ToolkitMethod } from './toolkit/protocol';

const ROUTED = new Set<Method>(TOOLKIT_METHODS);

export function composeEngine(classic: Engine, toolkit: ToolkitClient): Engine {
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
