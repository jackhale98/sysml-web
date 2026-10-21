/** Messages between the app and the library worker. */
export type LibraryCall =
	| { method: 'index' }
	| { method: 'file'; path: string }
	| { method: 'search'; query: string; limit: number }
	| { method: 'timing' };

/** A call, numbered, with the bundle's URL (read on the first call). */
export type LibraryRequest = { id: number; url: string } & LibraryCall;

export type LibraryResponse =
	{ id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
