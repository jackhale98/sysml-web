/**
 * How to put Fairtide on this device's Home Screen (or Dock, or app list),
 * worked out from the browser. Only Chromium offers an install prompt
 * (`beforeinstallprompt`); everywhere else the person does it from the
 * browser's own menus, so the guide shows those steps.
 *
 * Plain functions over what the browser reports, so they are easy to test.
 */

export type InstallPlatform =
	/** Already running as the installed app. */
	| 'installed'
	/** iPhone or iPad, Safari: Share → Add to Home Screen. */
	| 'ios-safari'
	/** iPhone or iPad, Chrome or Edge on iOS 16.4 or later: the same, from their share menu. */
	| 'ios-share'
	/** iPhone or iPad, any other browser (or an app's built-in browser): open in Safari first. */
	| 'ios-open-in-safari'
	/** Android without the install prompt (Firefox, Samsung Internet, …): from the browser menu. */
	| 'android'
	/** Safari on a Mac (macOS Sonoma or later): File → Add to Dock. */
	| 'mac-safari'
	/** Safari on a Mac before Sonoma: no way to install. */
	| 'mac-safari-old'
	/** Chrome, Edge and other Chromium browsers on a computer, or Chrome on Android. */
	| 'chromium'
	/** Anything else (Firefox on a computer, …): no way to install. */
	| 'unsupported';

export interface BrowserFacts {
	userAgent: string;
	/** `navigator.maxTouchPoints`: tells an iPad (which says it is a Mac) from a Mac. */
	maxTouchPoints?: number;
	/** Running as the installed app (`display-mode: standalone`, or `navigator.standalone` on iOS). */
	standalone?: boolean;
}

/** iPhone, iPod, or iPad (iPadOS says it is a Mac, but Macs have no touch screen). */
export function isIOS(facts: BrowserFacts): boolean {
	const ua = facts.userAgent;
	if (/iPhone|iPad|iPod/.test(ua)) return true;
	return /Macintosh/.test(ua) && (facts.maxTouchPoints ?? 0) > 1;
}

export function isAndroid(facts: BrowserFacts): boolean {
	return /Android/.test(facts.userAgent);
}

/** A phone or tablet: where a Home Screen icon matters most. */
export function isPhoneOrTablet(facts: BrowserFacts): boolean {
	return isIOS(facts) || isAndroid(facts);
}

/** The iOS version (`[major, minor]`) from `OS 17_4` or, on iPad, Safari's `Version/17.4`. */
export function iosVersion(ua: string): [number, number] | null {
	const os = /OS (\d+)[_.](\d+)/.exec(ua);
	if (os) return [Number(os[1]), Number(os[2])];
	const version = /Version\/(\d+)\.(\d+)/.exec(ua);
	return version ? [Number(version[1]), Number(version[2])] : null;
}

const atLeast = (v: [number, number] | null, major: number, minor: number) =>
	!!v && (v[0] > major || (v[0] === major && v[1] >= minor));

/** Browsers on iOS that aren't Safari, including apps' built-in browsers. */
const IOS_OTHER =
	/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|Ddg\/|YaBrowser|FBAN|FBAV|Instagram|Line\/|LinkedInApp|Twitter|MicroMessenger|Snapchat/;

export function installPlatform(facts: BrowserFacts): InstallPlatform {
	if (facts.standalone) return 'installed';
	const ua = facts.userAgent;
	if (isIOS(facts)) {
		if (/CriOS|EdgiOS/.test(ua))
			return atLeast(iosVersion(ua), 16, 4) ? 'ios-share' : 'ios-open-in-safari';
		if (IOS_OTHER.test(ua) || !/Safari\//.test(ua)) return 'ios-open-in-safari';
		return 'ios-safari';
	}
	if (isAndroid(facts)) {
		// Chrome-based browsers (not Samsung's or Firefox) offer their install prompt.
		if (/Chrome\//.test(ua) && !/SamsungBrowser|Firefox|OPR\/|UCBrowser/.test(ua))
			return 'chromium';
		return 'android';
	}
	if (
		/Macintosh/.test(ua) &&
		/Safari\//.test(ua) &&
		!/Chrome\/|Chromium|Edg\/|Firefox|OPR\//.test(ua)
	) {
		const version = /Version\/(\d+)/.exec(ua);
		// Safari 17 came with macOS Sonoma, which added "Add to Dock".
		return version && Number(version[1]) >= 17 ? 'mac-safari' : 'mac-safari-old';
	}
	if (/Chrome\/|Chromium|Edg\//.test(ua) && !/Firefox/.test(ua)) return 'chromium';
	return 'unsupported';
}

/**
 * Whether to offer installing here: the browser's prompt is ready, or the
 * browser has its own way that the guide can explain. (Chromium without the
 * prompt is usually installed already, so nothing is offered there.)
 */
export function canOfferInstall(platform: InstallPlatform, canPrompt: boolean): boolean {
	if (platform === 'installed') return false;
	if (canPrompt) return true;
	return (
		platform === 'ios-safari' ||
		platform === 'ios-share' ||
		platform === 'ios-open-in-safari' ||
		platform === 'android' ||
		platform === 'mac-safari'
	);
}

/** Whether the projects page shows its "keep it on your Home Screen" card. */
export function showInstallCard(
	facts: BrowserFacts,
	canPrompt: boolean,
	dismissed: boolean
): boolean {
	if (dismissed || !isPhoneOrTablet(facts)) return false;
	return canOfferInstall(installPlatform(facts), canPrompt);
}
