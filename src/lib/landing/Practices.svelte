<!--
	"Your practices, modernised": requirements, interfaces, verification and risk, each shown as the
	SysML view that replaces the document or spreadsheet it used to live in.
-->
<script lang="ts">
	import { Cable, Eye, FlaskConical, ListChecks, ShieldAlert } from '@lucide/svelte';
	import type { Component } from 'svelte';

	type Tone = 'ok' | 'warn' | 'danger' | 'muted';
	interface Practice {
		family: 'requirement' | 'interface' | 'analysis';
		icon: Component;
		title: string;
		was: string;
		text: string;
		view: string;
		rows: { id: string; label: string; status: string; tone: Tone }[];
		keywords: string[];
	}

	// Rows are the delivery-drone demo's own, as its views show them.
	const practices: Practice[] = [
		{
			family: 'requirement',
			icon: ListChecks,
			title: 'Requirements',
			was: 'Word documents',
			text: 'Each requirement is an element with an ID, a statement and an owner, traced to the parts that satisfy it and the tests that verify it. A limit with units is checked against the design.',
			view: 'Requirements table',
			rows: [
				{ id: 'SYS-001', label: 'Flight endurance', status: 'Satisfied', tone: 'ok' },
				{ id: 'SYS-003', label: 'Maximum take-off mass', status: 'Satisfied', tone: 'ok' },
				{ id: 'SYS-005', label: 'Ingress protection', status: 'Gap', tone: 'warn' }
			],
			keywords: ['requirement', 'satisfy', 'verify']
		},
		{
			family: 'interface',
			icon: Cable,
			title: 'Interfaces',
			was: 'ICD spreadsheets',
			text: 'Ports say what flows in and out; interfaces connect them. The interface table and the interface control document list every port and what it is connected to, so a loose end shows.',
			view: 'Interface table',
			rows: [
				{ id: 'powerOut', label: 'battery → power distribution', status: 'Connected', tone: 'ok' },
				{ id: 'commandLink', label: 'flight controller → radio', status: 'Connected', tone: 'ok' },
				{ id: 'imageOut', label: 'camera → ?', status: 'Not connected', tone: 'warn' }
			],
			keywords: ['port def', 'interface def', 'flow']
		},
		{
			family: 'analysis',
			icon: ShieldAlert,
			title: 'Risk and FMEA',
			was: 'FMEA workbooks',
			text: 'Failure modes sit on the components that fail, linked to their hazards and risk controls. The RPN, the action priority and whether the risk is acceptable are calculated in SysML, never typed in.',
			view: 'FMEA worksheet',
			rows: [
				{
					id: 'camera',
					label: 'Person under drop point not seen',
					status: 'RPN 288',
					tone: 'danger'
				},
				{ id: 'battery', label: 'Thermal runaway', status: 'RPN 144', tone: 'warn' },
				{ id: 'motor', label: 'Stops or loses torque', status: 'RPN 96', tone: 'warn' }
			],
			keywords: ['metadata', 'calc', 'requirement']
		},
		{
			family: 'requirement',
			icon: FlaskConical,
			title: 'Verification',
			was: 'test plans and reports',
			text: 'Verification cases name the requirement they prove and how, so coverage is a query instead of a weekly chase, and every gap is listed.',
			view: 'Verification matrix',
			rows: [
				{ id: 'RC-001', label: 'Battery thermal protection', status: 'Verified', tone: 'ok' },
				{ id: 'RC-005', label: 'Release height interlock', status: 'Verified', tone: 'ok' },
				{ id: 'RC-007', label: 'Drop-zone clearance check', status: 'Not verified', tone: 'warn' }
			],
			keywords: ['verification', 'objective', 'verify']
		}
	];
</script>

<ul class="grid">
	{#each practices as p (p.title)}
		<li class="card" style:--family="var(--kind-{p.family})">
			<div class="top">
				<span class="icon"><p.icon size={20} /></span>
				<div>
					<h3>{p.title}</h3>
					<p class="was">Instead of {p.was}</p>
				</div>
			</div>
			<p class="text">{p.text}</p>
			<div class="view">
				<p class="view-head"><Eye size={13} /> {p.view} <span>SysML view</span></p>
				<ul class="rows">
					{#each p.rows as row (row.id)}
						<li>
							<span class="id">{row.id}</span>
							<span class="label">{row.label}</span>
							<span class="status {row.tone}">{row.status}</span>
						</li>
					{/each}
				</ul>
			</div>
			<p class="keywords">
				{#each p.keywords as k (k)}<code>{k}</code>{/each}
			</p>
		</li>
	{/each}
</ul>

<style>
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 25rem), 1fr));
		gap: var(--space-4);
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}
	.card::before {
		content: '';
		position: absolute;
		inset: 0 0 auto;
		height: 3px;
		background: var(--family);
	}
	.top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-md);
		color: var(--family);
		background: color-mix(in srgb, var(--family) 12%, var(--surface));
	}
	h3 {
		font-size: var(--text-xl);
		letter-spacing: -0.015em;
	}
	.was {
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.text {
		color: var(--text-2);
		font-size: var(--text-md);
		line-height: 1.6;
	}
	.view {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg);
		overflow: hidden;
	}
	.view-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem var(--space-3);
		border-bottom: 1px solid var(--border);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text);
	}
	.view-head :global(svg) {
		color: var(--kind-view);
	}
	.view-head span {
		margin-left: auto;
		color: var(--kind-view);
		font-weight: 600;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		display: grid;
		grid-template-columns: 6.25rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3);
		padding: 0.4rem var(--space-3);
		font-size: var(--text-sm);
	}
	.rows li + li {
		border-top: 1px solid var(--border);
	}
	.id {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--family);
		font-weight: 550;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.05rem 0.5rem;
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
		color: var(--tone);
		background: var(--tone-weak);
	}
	.status::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.ok {
		--tone: var(--ok);
		--tone-weak: var(--ok-weak);
	}
	.warn {
		--tone: var(--warn);
		--tone-weak: var(--warn-weak);
	}
	.danger {
		--tone: var(--danger);
		--tone-weak: var(--danger-weak);
	}
	.muted {
		--tone: var(--muted);
		--tone-weak: var(--muted-weak);
	}
	.keywords {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: auto;
	}
	.keywords code {
		padding: 0.1rem 0.45rem;
		border-radius: 4px;
		background: var(--surface-2);
		color: var(--syntax-keyword);
		font-size: var(--text-xs);
	}
	@media (max-width: 26rem) {
		.rows li {
			grid-template-columns: 5.25rem minmax(0, 1fr) auto;
			gap: var(--space-2);
		}
	}
</style>
