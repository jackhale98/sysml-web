import { describe, expect, it } from 'vitest';
import {
	canOfferInstall,
	installPlatform,
	iosVersion,
	isIOS,
	showInstallCard,
	type BrowserFacts
} from './install.ts';

const UA = {
	iphoneSafari:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
	ipadSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
	iphoneChrome:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
	iphoneChromeOld:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/108.0.5359.112 Mobile/15E148 Safari/604.1',
	iphoneEdge:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/120.0.2210.126 Mobile/15E148 Safari/605.1.15',
	iphoneFirefox:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15',
	iphoneInstagram:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
	androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
	androidSamsung:
		'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
	macSafariOld:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
	macChrome:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
	windowsEdge:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
	windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'
};

const on = (userAgent: string, extra: Partial<BrowserFacts> = {}) =>
	installPlatform({ userAgent, maxTouchPoints: 0, ...extra });

describe('how this browser installs', () => {
	it('iPhone and iPad Safari: Share, then Add to Home Screen', () => {
		expect(on(UA.iphoneSafari, { maxTouchPoints: 5 })).toBe('ios-safari');
		// iPadOS says it is a Mac; its touch screen gives it away.
		expect(on(UA.ipadSafari, { maxTouchPoints: 5 })).toBe('ios-safari');
		expect(isIOS({ userAgent: UA.ipadSafari, maxTouchPoints: 5 })).toBe(true);
	});

	it('Chrome and Edge on iOS 16.4 and later: from their share menu', () => {
		expect(on(UA.iphoneChrome)).toBe('ios-share');
		expect(on(UA.iphoneEdge)).toBe('ios-share');
	});

	it('other iOS browsers, older ones and apps’ built-in browsers: open in Safari', () => {
		expect(on(UA.iphoneChromeOld)).toBe('ios-open-in-safari');
		expect(on(UA.iphoneFirefox)).toBe('ios-open-in-safari');
		expect(on(UA.iphoneInstagram)).toBe('ios-open-in-safari');
	});

	it('Android: Chrome has its install prompt; others are told where the menu item is', () => {
		expect(on(UA.androidChrome)).toBe('chromium');
		expect(on(UA.androidFirefox)).toBe('android');
		expect(on(UA.androidSamsung)).toBe('android');
	});

	it('a Mac: Safari on Sonoma adds to the Dock; earlier Safari cannot', () => {
		expect(on(UA.macSafari)).toBe('mac-safari');
		expect(on(UA.macSafariOld)).toBe('mac-safari-old');
		expect(isIOS({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe(false);
	});

	it('computers: Chromium installs, Firefox cannot', () => {
		expect(on(UA.macChrome)).toBe('chromium');
		expect(on(UA.windowsEdge)).toBe('chromium');
		expect(on(UA.windowsFirefox)).toBe('unsupported');
	});

	it('already installed, on any platform', () => {
		for (const ua of Object.values(UA)) expect(on(ua, { standalone: true })).toBe('installed');
	});

	it('reads the iOS version', () => {
		expect(iosVersion(UA.iphoneSafari)).toEqual([18, 5]);
		expect(iosVersion(UA.ipadSafari)).toEqual([18, 5]);
		expect(iosVersion('nothing')).toBeNull();
	});
});

describe('offering to install', () => {
	it('where the browser prompts, or the guide can explain how', () => {
		expect(canOfferInstall('ios-safari', false)).toBe(true);
		expect(canOfferInstall('ios-open-in-safari', false)).toBe(true);
		expect(canOfferInstall('android', false)).toBe(true);
		expect(canOfferInstall('mac-safari', false)).toBe(true);
		expect(canOfferInstall('chromium', true)).toBe(true);
	});

	it('not when installed, nor where there is no way (or it is likely installed already)', () => {
		expect(canOfferInstall('installed', true)).toBe(false);
		expect(canOfferInstall('chromium', false)).toBe(false);
		expect(canOfferInstall('unsupported', false)).toBe(false);
		expect(canOfferInstall('mac-safari-old', false)).toBe(false);
	});

	it('the projects page card: phones and tablets, not installed, not dismissed', () => {
		const iphone = { userAgent: UA.iphoneSafari, maxTouchPoints: 5 };
		expect(showInstallCard(iphone, false, false)).toBe(true);
		expect(showInstallCard(iphone, false, true)).toBe(false);
		expect(showInstallCard({ ...iphone, standalone: true }, false, false)).toBe(false);
		expect(showInstallCard({ userAgent: UA.androidChrome }, true, false)).toBe(true);
		expect(showInstallCard({ userAgent: UA.androidChrome }, false, false)).toBe(false);
		// Computers get "Install app" in the menu and Settings, not the card.
		expect(showInstallCard({ userAgent: UA.macSafari }, false, false)).toBe(false);
		expect(showInstallCard({ userAgent: UA.windowsEdge }, true, false)).toBe(false);
	});
});
