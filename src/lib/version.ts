import pkg from '../../package.json';

/** Application version, sourced from package.json (`CONTRIBUTING.md`, "Releases"). */
export const version: string = pkg.version;

/** The commit this build was made from, abbreviated; '' when built outside git. */
export const commit: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '';

/** The day this build was made (`YYYY-MM-DD`). */
export const built: string = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : '';
