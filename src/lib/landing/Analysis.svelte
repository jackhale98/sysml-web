<!--
	"Analysis on top": what Fairtide works out from the model, each with a small picture of what
	the workbench shows. The figures are the delivery-drone demo's own (the risk matrix's zones are
	only a pattern). Static content; no behaviour.
-->
<script lang="ts">
	import {
		ArrowRight,
		FileText,
		Grid3x3,
		Play,
		Scale,
		ShieldAlert,
		Timer,
		Weight
	} from '@lucide/svelte';

	/** Part DSM: four of the demo's parts, and how each row leads to each column. */
	const dsmParts = ['Battery', 'Power distribution', 'Flight controller', 'GNSS'];
	const dsm: string[][] = [
		['', 'C', '', ''],
		['C', '', 'C', ''],
		['', 'C', '', ''],
		['', '', 'F', '']
	];
</script>

<ul class="grid">
	<li class="card" style:--family="var(--kind-requirement)">
		<span class="icon"><Weight size={20} /></span>
		<h3>Checks and budgets</h3>
		<p class="text">
			Write a limit with units and the model is checked against it: is the design within it, and by
			how much? Mass, power or cost add up over the parts.
		</p>
		<ul class="mini checks" aria-hidden="true">
			<li>
				<span>Endurance</span>
				<span class="figure">27.5 min ≥ 25 min</span>
				<span class="status ok">Satisfied</span>
			</li>
			<li>
				<span>Take-off mass</span>
				<span class="figure">3.77 kg ≤ 4 kg</span>
				<span class="status ok">Satisfied</span>
			</li>
		</ul>
	</li>

	<li class="card" style:--family="var(--kind-analysis)">
		<span class="icon"><Scale size={20} /></span>
		<h3>Trade studies</h3>
		<p class="text">
			Weigh the options on criteria you choose. The ranking is worked out from the model, so it
			changes when a value does.
		</p>
		<ul class="mini bars" aria-hidden="true">
			<li class="best">
				<span>semiSolidState</span><span class="bar" style:--score="0.59"></span><b>0.59</b>
			</li>
			<li><span>drone.battery</span><span class="bar" style:--score="0.39"></span><b>0.39</b></li>
			<li><span>lithiumPolymer</span><span class="bar" style:--score="0.28"></span><b>0.28</b></li>
		</ul>
	</li>

	<li class="card" style:--family="var(--kind-behavior)">
		<span class="icon"><Play size={20} /></span>
		<h3>Simulate state machines</h3>
		<p class="text">
			Send events and step through any state machine on a simulated clock: timers fire, values
			change and a timeline records each step.
		</p>
		<div class="mini sim" aria-hidden="true">
			<span class="state">flying</span>
			<span class="arrow"><ArrowRight size={14} /></span>
			<span class="state now">returningHome</span>
			<span class="clock"><Timer size={13} /> 5 · 10 · 15 min</span>
			<code><b>accept after</b> 5 [SI::min]</code>
		</div>
	</li>

	<li class="card" style:--family="var(--danger)">
		<span class="icon"><ShieldAlert size={20} /></span>
		<h3>Risk analysis</h3>
		<p class="text">
			Design, process and use FMEAs, hazards and a hazard log, risk controls linked to each line,
			and a risk matrix coloured by your own risk policy.
		</p>
		<div class="mini risk" aria-hidden="true">
			{#each ['mid', 'high', 'high', 'low', 'mid', 'high', 'low', 'low', 'mid'] as zone, i (i)}
				<span class="cell {zone}"></span>
			{/each}
			<p>
				<span class="status danger">AP High</span>
				<span class="status warn">RPN 144</span>
				<span class="status ok">Verified control</span>
			</p>
		</div>
	</li>

	<li class="card" style:--family="var(--kind-interface)">
		<span class="icon"><Grid3x3 size={20} /></span>
		<h3>Dependency matrices</h3>
		<p class="text">
			A DSM or an N² chart of parts, process steps or requirements, with suggested modules and what
			a change to one part may reach.
		</p>
		<div class="mini dsm" aria-hidden="true">
			{#each dsmParts as part, row (part)}
				<span class="name">{part}</span>
				{#each dsm[row] as mark, col (col)}
					<span class="mark" class:self={row === col}>{row === col ? row + 1 : mark}</span>
				{/each}
			{/each}
		</div>
	</li>

	<li class="card" style:--family="var(--kind-view)">
		<span class="icon"><FileText size={20} /></span>
		<h3>Reports and exports</h3>
		<p class="text">
			A specification and an interface control document made from the model, to print, save as PDF
			or send round; any table to Excel, any diagram to SVG or PNG.
		</p>
		<p class="mini formats" aria-hidden="true">
			<span>PDF</span><span>HTML</span><span>Markdown</span><span>Excel</span><span>CSV</span><span
				>SVG</span
			><span>PNG</span>
		</p>
	</li>
</ul>

<style>
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
		gap: var(--space-4);
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
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
	.icon {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-md);
		color: var(--family);
		background: color-mix(in srgb, var(--family) 12%, var(--surface));
	}
	h3 {
		margin-top: var(--space-4);
		font-size: var(--text-xl);
		letter-spacing: -0.015em;
	}
	.text {
		margin-top: var(--space-2);
		color: var(--text-2);
		line-height: 1.6;
	}

	/* The small pictures sit at the foot of each card. */
	.mini {
		margin: auto 0 0;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg);
		font-size: var(--text-xs);
		list-style: none;
	}
	.card > .text {
		margin-bottom: var(--space-5);
	}
	.status {
		display: inline-flex;
		align-items: center;
		padding: 0.05rem 0.5rem;
		border-radius: var(--radius-pill);
		font-weight: 600;
		white-space: nowrap;
		color: var(--tone);
		background: var(--tone-weak);
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

	.checks li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--space-2);
		padding: 0.3rem 0;
	}
	.checks li + li {
		border-top: 1px solid var(--border);
	}
	.checks li > span:first-child {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.figure {
		font-family: var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
	}

	.bars li {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr) 2.25rem;
		align-items: center;
		gap: var(--space-2);
		padding: 0.2rem 0;
		font-family: var(--font-mono);
		color: var(--text-2);
	}
	.bars li > span:first-child {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.bars b {
		text-align: right;
		font-weight: 600;
		color: var(--text);
	}
	.bar {
		height: 0.4rem;
		border-radius: var(--radius-pill);
		background: linear-gradient(
			90deg,
			var(--bar) calc(var(--score) * 100% / 0.6),
			var(--surface-2) 0
		);
		--bar: var(--text-3);
	}
	.best .bar {
		--bar: var(--accent);
	}
	.best > span:first-child {
		color: var(--accent);
		font-weight: 600;
	}

	.sim {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.state {
		padding: 0.2rem 0.6rem;
		border: 1.5px solid var(--kind-behavior);
		border-radius: 999px;
		background: var(--surface);
		font-weight: 600;
	}
	.state.now {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	.arrow {
		display: inline-flex;
		color: var(--text-3);
	}
	.clock {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
		font-family: var(--font-mono);
		color: var(--text-2);
	}
	.sim code {
		flex-basis: 100%;
		color: var(--syntax-name);
	}
	.sim code b {
		font-weight: 550;
		color: var(--syntax-keyword);
	}

	.risk {
		display: grid;
		grid-template-columns: repeat(3, 1.6rem);
		grid-auto-rows: 1.6rem;
		gap: 3px;
		column-gap: 3px;
		align-items: center;
	}
	.risk p {
		grid-column: 4;
		grid-row: 1 / span 3;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
		margin-left: var(--space-3);
	}
	.cell {
		display: grid;
		place-items: center;
		height: 100%;
		border-radius: 3px;
		font-weight: 600;
		color: var(--text);
	}
	.cell.low {
		background: color-mix(in srgb, var(--ok) 22%, var(--surface));
	}
	.cell.mid {
		background: color-mix(in srgb, var(--warn) 25%, var(--surface));
	}
	.cell.high {
		background: color-mix(in srgb, var(--danger) 28%, var(--surface));
	}

	.dsm {
		display: grid;
		grid-template-columns: minmax(0, 1fr) repeat(4, 1.5rem);
		gap: 2px;
		align-items: center;
	}
	.dsm .name {
		padding-right: var(--space-2);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--text-2);
	}
	.mark {
		display: grid;
		place-items: center;
		height: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 3px;
		background: var(--surface);
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--kind-interface);
	}
	.mark.self {
		background: var(--surface-2);
		color: var(--text-3);
	}

	.formats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.formats span {
		padding: 0.1rem 0.5rem;
		border-radius: 4px;
		background: var(--surface-2);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-weight: 550;
	}
</style>
