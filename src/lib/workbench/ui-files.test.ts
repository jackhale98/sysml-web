import { describe, expect, it } from 'vitest';
import { WorkbenchUi, tabId } from './ui.svelte.ts';

function withTabs(paths: string[], active: number): WorkbenchUi {
	const ui = new WorkbenchUi();
	for (const path of paths) ui.open({ kind: 'file', path });
	ui.active = active;
	return ui;
}

describe('tabs follow their file', () => {
	it('a renamed file keeps its tab, in place and on show', () => {
		const ui = withTabs(['a.sysml', 'b.sysml'], 1);
		ui.fileLayouts['a.sysml'] = 'text';
		ui.select('a.sysml@12', 'explorer');
		ui.followFile('a.sysml', 'x/a.sysml');
		expect(ui.tabs.map(tabId)).toEqual(['home', 'file:x/a.sysml', 'file:b.sysml']);
		expect(ui.active).toBe(1);
		expect(ui.fileLayouts).toEqual({ 'x/a.sysml': 'text' });
		expect(ui.selection?.key).toBe('x/a.sysml@12');
	});

	it("a deleted file's tab closes, and the one before it shows", () => {
		const ui = withTabs(['a.sysml', 'b.sysml'], 2);
		ui.followFile('b.sysml', null);
		expect(ui.tabs.map(tabId)).toEqual(['home', 'file:a.sysml']);
		expect(ui.active).toBe(1);

		const other = withTabs(['a.sysml', 'b.sysml'], 2);
		other.select('a.sysml@0', 'explorer');
		other.followFile('a.sysml', null);
		expect(other.tabs.map(tabId)).toEqual(['home', 'file:b.sysml']);
		expect(other.active).toBe(1);
		expect(other.selection).toBeNull();
	});

	it('leaves the overview when the last tab goes', () => {
		const ui = withTabs(['a.sysml'], 1);
		ui.close(0);
		ui.followFile('a.sysml', null);
		expect(ui.tabs.map(tabId)).toEqual(['home']);
		expect(ui.active).toBe(0);
	});
});
