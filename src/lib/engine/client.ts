import type { EngineApi, Method } from './protocol';
import type { ToolkitClient } from './toolkit/client';

/** The engine, as seen from the UI: every call is asynchronous. */
export type Engine = {
	[M in Method]: (...params: Parameters<EngineApi[M]>) => Promise<ReturnType<EngineApi[M]>>;
} & { terminate(): void };

/** The app's engine: every call goes to the sysml-toolkit worker. */
export function toolkitEngine(toolkit: ToolkitClient): Engine {
	return {
		version: (...params) => toolkit.call('version', ...params),
		analyze: (...params) => toolkit.call('analyze', ...params),
		analyzeProject: (...params) => toolkit.call('analyzeProject', ...params),
		elementDetails: (...params) => toolkit.call('elementDetails', ...params),
		highlight: (...params) => toolkit.call('highlight', ...params),
		format: (...params) => toolkit.call('format', ...params),
		complete: (...params) => toolkit.call('complete', ...params),
		hover: (...params) => toolkit.call('hover', ...params),
		definition: (...params) => toolkit.call('definition', ...params),
		references: (...params) => toolkit.call('references', ...params),
		renameSymbol: (...params) => toolkit.call('renameSymbol', ...params),
		outline: (...params) => toolkit.call('outline', ...params),
		codeActions: (...params) => toolkit.call('codeActions', ...params),
		listViews: (...params) => toolkit.call('listViews', ...params),
		renderView: (...params) => toolkit.call('renderView', ...params),
		viewLibraries: (...params) => toolkit.call('viewLibraries', ...params),
		diagram: (...params) => toolkit.call('diagram', ...params),
		stateMachines: (...params) => toolkit.call('stateMachines', ...params),
		edit: (...params) => toolkit.call('edit', ...params),
		checks: (...params) => toolkit.call('checks', ...params),
		evaluate: (...params) => toolkit.call('evaluate', ...params),
		tradeStudies: (...params) => toolkit.call('tradeStudies', ...params),
		terminate: () => toolkit.terminate()
	};
}
