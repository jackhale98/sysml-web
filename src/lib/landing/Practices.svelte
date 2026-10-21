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

	const practices: Practice[] = [
		{
			family: 'requirement',
			icon: ListChecks,
			title: 'Requirements',
			was: 'Word documents',
			text: 'Each requirement is an element with an ID, a statement and an owner, traced to the parts that satisfy it and the tests that verify it.',
			view: 'Requirements table',
			rows: [
				{ id: 'SYS-001', label: 'Flight endurance', status: 'Verified', tone: 'ok' },
				{ id: 'SYS-004', label: 'Wind tolerance', status: 'Satisfied', tone: 'ok' },
				{ id: 'SYS-005', label: 'Ingress protection', status: 'Not traced', tone: 'warn' }
			],
			keywords: ['requirement', 'satisfy', 'verify']
		},
		{
			family: 'interface',
			icon: Cable,
			title: 'Interfaces',
			was: 'ICD spreadsheets',
			text: 'Ports say what flows in and out; interfaces connect them. Wire two parts together and mismatched ends show up at once.',
			view: 'Interface table',
			rows: [
				{ id: 'PowerSupply', label: 'battery → motors', status: 'Matched', tone: 'ok' },
				{ id: 'CommandLink', label: 'radio → flight ctrl', status: 'Matched', tone: 'ok' },
				{ id: 'ImagePort', label: 'camera → ?', status: 'Unconnected', tone: 'warn' }
			],
			keywords: ['port def', 'interface def', 'flow']
		},
		{
			family: 'analysis',
			icon: ShieldAlert,
			title: 'Risk and FMEA',
			was: 'FMEA workbooks',
			text: 'Failure modes sit on the components that fail, linked to their controls. The risk priority number is calculated in SysML, never typed in.',
			view: 'Design FMEA',
			rows: [
				{ id: 'Battery', label: 'Thermal runaway', status: 'RPN 90', tone: 'danger' },
				{ id: 'Rotor', label: 'Blade crack', status: 'RPN 48', tone: 'warn' },
				{ id: 'GNSS', label: 'Signal loss', status: 'RPN 24', tone: 'ok' }
			],
			keywords: ['calc', 'metadata', 'occurrence']
		},
		{
			family: 'requirement',
			icon: FlaskConical,
			title: 'Verification',
			was: 'test plans and reports',
			text: 'Verification cases name the requirement they prove and the verdict they expect, so coverage is a query instead of a weekly chase.',
			view: 'Verification matrix',
			rows: [
				{ id: 'VC-001', label: 'Endurance flight', status: 'Passed', tone: 'ok' },
				{ id: 'VC-003', label: 'Wind hold', status: 'Planned', tone: 'muted' },
				{ id: 'VC-005', label: 'Battery abuse', status: 'Failed', tone: 'danger' }
			],
			keywords: ['verification', 'objective', 'verdict']
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
