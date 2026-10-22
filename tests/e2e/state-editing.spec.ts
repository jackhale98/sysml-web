import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Building behaviour by drawing: a state machine in a new project, from an
 * empty state definition to a run in the simulator; an action flow with a
 * decision; and the same gestures on a phone.
 */

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

/** A new project, with a state or action definition added in its Structure view and opened. */
async function newBehavior(
	page: Page,
	project: string,
	kind: 'state def' | 'action def',
	name: string
) {
	await page.goto('/projects');
	await page.getByLabel('Name').fill(project);
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Structure', exact: true })
		.click();
	const structure = page.getByRole('region', { name: /Structure diagram/ });
	await expect(structure.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 15_000 });
	// Add puts it in the selected package.
	const pkg = project.replace(/\s+/g, '');
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: pkg, exact: true })
		.click();
	await structure.getByRole('button', { name: 'Add' }).click();
	await structure.getByLabel('Kind').selectOption(kind);
	await structure.getByLabel('Name').fill(name);
	await structure.getByRole('button', { name: 'Add', exact: true }).last().click();
	const node = structure.locator(`.svelte-flow__node[data-id="${name}"]`);
	await expect(node).toBeVisible({ timeout: 15_000 });
	await node.click({ button: 'right' });
	await page
		.getByRole('menuitem', {
			name: kind === 'state def' ? 'Open its state diagram' : 'Open its action flow'
		})
		.click();
	const diagram = page.getByRole('region', { name: `${name} diagram` });
	await expect(diagram.getByText('Nothing to show in this view yet.')).toBeVisible();
	return diagram;
}

const nodeOf = (diagram: Locator, id: string) =>
	diagram.locator(`.svelte-flow__node[data-id="${id}"]`);

/** Add a state (or step) with the toolbar's Add form. */
async function add(
	diagram: Locator,
	what: string,
	name: string | null,
	options: { start?: boolean; type?: string } = {}
) {
	await diagram.getByRole('button', { name: 'Add', exact: true }).first().click();
	const form = diagram.getByRole('form', { name: /^Add to/ });
	await form.getByText(what, { exact: true }).click();
	if (name !== null) await form.getByLabel('Name').fill(name);
	const start = form.getByRole('checkbox', { name: 'Starts here' });
	if ((await start.count()) && (await start.isChecked()) !== !!options.start) await start.click();
	if (options.type) await form.getByLabel('Kind of value').selectOption(options.type);
	await form.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(form).toBeHidden();
	if (name !== null && what !== 'Value') await expect(nodeOf(diagram, name)).toBeVisible();
}

/** Draw from one node to another with the keyboard's Connect (C), then pick the target. */
async function connect(page: Page, diagram: Locator, from: string, to: string) {
	await nodeOf(diagram, from).click();
	await page.keyboard.press('c');
	await nodeOf(diagram, to).click();
}

test('a state machine drawn in a new project runs, and its transitions can be changed', async ({
	page
}) => {
	const diagram = await newBehavior(page, 'Lamp bench', 'state def', 'Lamp');

	await add(diagram, 'State', 'off', { start: true });
	await add(diagram, 'State', 'on');
	await add(diagram, 'State', 'broken');
	await add(diagram, 'Value', 'presses', { type: 'Integer' });
	await expect(diagram.locator('.svelte-flow__node[data-id="__initial__"]')).toBeVisible();

	// off → on by dragging from one of the state's handles onto the other state.
	await nodeOf(diagram, 'off').click();
	const handle = nodeOf(diagram, 'off').locator('.svelte-flow__handle.connect').first();
	await handle.hover();
	await page.mouse.down();
	const target = (await nodeOf(diagram, 'on').boundingBox())!;
	await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
	await page.mouse.up();
	let form = page.getByRole('dialog', { name: 'Transition from off to on' });
	await form.getByLabel('Signal', { exact: true }).fill('SwitchOn');
	await expect(
		form.getByText('SwitchOn is new: it will be added as an item definition.')
	).toBeVisible();
	await expect(form.getByLabel('SysML that will be written')).toContainText(
		'transition off_to_on first off accept SwitchOn then on;'
	);
	await form.getByRole('button', { name: 'Add transition' }).click();
	await expect(form).toBeHidden();

	// on → off and on → broken with Connect (C) and a pick.
	await connect(page, diagram, 'on', 'off');
	form = page.getByRole('dialog', { name: 'Transition from on to off' });
	await form.getByLabel('Signal', { exact: true }).fill('switch off');
	await form.getByRole('button', { name: 'Add transition' }).click();
	await expect(form).toBeHidden();
	await connect(page, diagram, 'on', 'broken');
	form = page.getByRole('dialog', { name: 'Transition from on to broken' });
	await form.getByText('Something becomes true').click();
	await form.getByLabel('Condition', { exact: true }).fill('presses > 2');
	await form.getByLabel(/Then do/).fill('call technician');
	await form.getByRole('button', { name: 'Add transition' }).click();
	await expect(form).toBeHidden();

	await expect(diagram.locator('.svelte-flow__edge')).toHaveCount(4);
	await expect(diagram.getByText('when presses > 2 / callTechnician')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();
	await expectAccessible(page);

	// The machine is listed under Simulations and runs.
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Run Lamp' })
		.click();
	const emulator = page.locator('section.emulator');
	await expect(emulator.getByText(/Started in off/)).toBeVisible({ timeout: 15_000 });
	await emulator.getByRole('button', { name: /^SwitchOn to on/ }).click();
	await expect(emulator.getByText(/Now in on/)).toBeVisible();
	await emulator.getByRole('button', { name: /^SwitchOff to off/ }).click();
	await expect(emulator.getByText(/Now in off/)).toBeVisible();
	await expectAccessible(page);

	// Change a guard from the transition's label; Undo puts it back.
	await page.getByRole('tab', { name: 'Lamp', exact: true }).first().click();
	await diagram.getByRole('button', { name: 'Change transition: SwitchOn' }).click();
	form = page.getByRole('dialog', { name: 'Transition from off to on' });
	await form.getByLabel(/Only if/).fill('presses < 3');
	await form.getByRole('button', { name: 'Save' }).click();
	await expect(diagram.getByText('SwitchOn [presses < 3]')).toBeVisible();
	await page
		.locator('.toast')
		.filter({ hasText: 'Changed the transition from off' })
		.getByRole('button', { name: 'Undo' })
		.click();
	await expect(diagram.getByRole('button', { name: 'Change transition: SwitchOn' })).toBeVisible();
	await expect(diagram.getByText('SwitchOn [presses < 3]')).toHaveCount(0);

	// What a state does, from its menu.
	await nodeOf(diagram, 'broken').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'What it does…' }).click();
	const actions = page.getByRole('dialog', { name: 'What broken does' });
	await actions.getByText('While in it').click();
	await actions.getByLabel(/Then do/).fill('blink');
	await actions.getByRole('button', { name: 'Save' }).click();
	await expect(nodeOf(diagram, 'broken').getByText('do / blink')).toBeVisible();

	// The inspector changes a named transition too.
	await page.getByPlaceholder('Filter elements').fill('on_to_off');
	await page
		.getByRole('button', { name: /on_to_off/ })
		.first()
		.click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByText('SwitchOff arrives')).toBeVisible();
	await inspector.getByRole('button', { name: 'Change when, only if, then do' }).click();
	await inspector.getByLabel(/Then do/).fill('presses := presses + 1');
	await inspector.getByRole('button', { name: 'Save' }).click();
	await expect(inspector.getByText('presses := presses + 1')).toBeVisible();

	// A transition is deleted from its line.
	await page.getByRole('tab', { name: 'Lamp', exact: true }).first().click();
	await diagram.getByRole('group', { name: /transition from on to broken/ }).focus();
	await page.keyboard.press('Delete');
	const confirm = page.getByRole('alertdialog', { name: 'Delete this transition?' });
	await confirm.getByRole('button', { name: 'Delete' }).click();
	await expect(diagram.locator('.svelte-flow__edge')).toHaveCount(3);
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();
	await expectAccessible(page);
});

test('an action flow with a decision is drawn step by step', async ({ page }) => {
	const diagram = await newBehavior(page, 'Tea bench', 'action def', 'MakeTea');

	await add(diagram, 'Value', 'hot', { type: 'Boolean' });
	await add(diagram, 'Action', 'boil', { start: true });
	await add(diagram, 'Decision', null);
	await expect(nodeOf(diagram, 'decision1')).toBeVisible();
	await add(diagram, 'Action', 'pour');
	await add(diagram, 'Action', 'wait');

	// A plain next step is written at once.
	await connect(page, diagram, 'boil', 'decision1');
	await expect(
		page.locator('.toast').filter({ hasText: 'boil is now followed by decision1' })
	).toBeVisible();

	// From a decision, each way asks "Only if…"; an empty one is the way otherwise.
	await connect(page, diagram, 'decision1', 'pour');
	let form = page.getByRole('dialog', { name: 'Branch from decision1 to pour' });
	await form.getByLabel(/Only if/).fill('hot');
	await expect(form.getByLabel('SysML that will be written')).toHaveText('if hot then pour;');
	await form.getByRole('button', { name: 'Add branch' }).click();
	await expect(form).toBeHidden();
	await connect(page, diagram, 'decision1', 'wait');
	form = page.getByRole('dialog', { name: 'Branch from decision1 to wait' });
	await expect(form.getByLabel('SysML that will be written')).toHaveText('else wait;');
	await form.getByRole('button', { name: 'Add branch' }).click();
	await expect(form).toBeHidden();

	await nodeOf(diagram, 'pour').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Ends here' }).click();
	await expect(diagram.locator('.svelte-flow__node[data-id="__final__"]')).toBeVisible();
	await expect(diagram.getByText('[hot]')).toBeVisible();
	await expect(diagram.getByText('[else]')).toBeVisible();
	await expect(diagram.locator('.svelte-flow__edge')).toHaveCount(5);

	// A branch's condition changes from its label.
	await diagram.getByRole('button', { name: 'Change branch: [hot]' }).click();
	form = page.getByRole('dialog', { name: 'Branch from decision1 to pour' });
	await form.getByLabel(/Only if/).fill('hot and true');
	await form.getByRole('button', { name: 'Save' }).click();
	await expect(diagram.getByText('[hot and true]')).toBeVisible();

	// Deleting the decision takes its lines with it.
	await nodeOf(diagram, 'decision1').click();
	await page.keyboard.press('Delete');
	const confirm = page.getByRole('alertdialog', { name: 'Delete decision1?' });
	await expect(confirm.getByText(/and 3 lines to and from it/)).toBeVisible();
	await confirm.getByRole('button', { name: 'Delete' }).click();
	await expect(nodeOf(diagram, 'decision1')).toHaveCount(0);
	await expect(diagram.locator('.svelte-flow__edge')).toHaveCount(2);
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();
	await expectAccessible(page);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	/** Hold a finger on an element until its menu opens. */
	async function longPress(target: Locator) {
		await target.evaluate(async (el) => {
			const r = el.getBoundingClientRect();
			const at = {
				clientX: r.left + r.width / 2,
				clientY: r.top + r.height / 2,
				bubbles: true,
				pointerType: 'touch'
			};
			el.dispatchEvent(new PointerEvent('pointerdown', at));
			await new Promise((done) => setTimeout(done, 700));
			el.dispatchEvent(new PointerEvent('pointerup', at));
		});
	}

	test('a transition is drawn from a state’s menu, in a bottom sheet', async ({ page }) => {
		await page.goto('/p/demo');
		await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
			timeout: 30_000
		});
		await page.getByRole('button', { name: /Switch view$/ }).click();
		await page
			.getByRole('dialog', { name: 'Views' })
			.getByRole('button', { name: /Flight mode states/ })
			.click();
		const diagram = page.getByRole('region', { name: /Flight mode states diagram/ });
		await expect(nodeOf(diagram, 'idle')).toBeVisible({ timeout: 15_000 });

		await longPress(nodeOf(diagram, 'idle').locator('.box'));
		await page.getByRole('menuitem', { name: 'Add transition from here' }).click();
		await nodeOf(diagram, 'landing').tap();
		const sheet = page.getByRole('dialog', { name: 'Transition from idle to landing' });
		await expect(sheet).toHaveClass(/sheet/);
		const box = (await sheet.boundingBox())!;
		expect(box.x).toBe(0);
		expect(box.width).toBe(390);
		await sheet.getByText('After a while').tap();
		await sheet.getByLabel('Seconds', { exact: true }).fill('10');
		await expect(sheet.getByLabel('SysML that will be written')).toHaveText(
			'transition idle_to_landing first idle accept after 10 [SI::s] then landing;'
		);
		await expectAccessible(page);
		await sheet.getByRole('button', { name: 'Add transition' }).tap();
		await expect(sheet).toBeHidden();
		await expect(diagram.getByText('after 10 [SI::s]')).toBeVisible();

		// Its label opens the same sheet to change it.
		await diagram.getByRole('button', { name: 'Change transition: after 10 [SI::s]' }).tap();
		await expect(page.getByRole('dialog', { name: 'Transition from idle to landing' })).toHaveClass(
			/sheet/
		);
		const widths = await page.evaluate(() => ({
			scroll: document.documentElement.scrollWidth,
			client: document.documentElement.clientWidth
		}));
		expect(widths.scroll).toBe(widths.client);
	});
});
