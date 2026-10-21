<!--
	"SysML that explains itself": a keyword hover in the text and the inspector for a selected part,
	drawn as the workbench shows them. Static content; no behaviour.
-->
<script lang="ts">
	import { Boxes, Check, CircleDot, Lightbulb, TriangleAlert } from '@lucide/svelte';
</script>

<div class="concept">
	<figure class="hover-card">
		<figcaption class="visually-hidden">Hovering a keyword in the text explains it.</figcaption>
		<div class="snippet">
			<div>
				<span class="k">part def</span> <span class="d">Drone</span> <span class="o">{'{'}</span>
			</div>
			<div class="in">
				<span class="k">part</span> battery <span class="o">:</span>
				<span class="t">Battery</span><span class="o">;</span>
			</div>
			<div class="in">
				<span class="k hovered">port</span> power <span class="o">: ~</span><span class="t"
					>PowerPort</span
				><span class="o">;</span>
			</div>
			<div><span class="o">}</span></div>
		</div>
		<div class="tip">
			<p class="tip-head">
				<CircleDot size={14} /> <code>port</code> <span>Port usage</span>
			</p>
			<p>A connection point on a part, where things like power, data or fluid go in or out.</p>
		</div>
	</figure>

	<figure class="inspector">
		<figcaption class="visually-hidden">The inspector explains the selected element.</figcaption>
		<div class="head">
			<span class="icon"><Boxes size={18} /></span>
			<div>
				<p class="title"><span class="stereo">«part»</span> battery : Battery</p>
				<p class="kind">Part usage</p>
			</div>
		</div>
		<p class="summary">
			A component in a specific place and role, such as the battery inside this drone.
		</p>
		<p class="analogy">
			<Lightbulb size={15} />
			<span>Like a line in a bill of materials, or a reference designator on a drawing.</span>
		</p>
		<dl class="props">
			<div>
				<dt>Name</dt>
				<dd>battery</dd>
			</div>
			<div>
				<dt>Defined by</dt>
				<dd><span class="chip def">Battery</span></dd>
			</div>
			<div>
				<dt>Owned by</dt>
				<dd><span class="chip def">Drone</span></dd>
			</div>
			<div>
				<dt>Multiplicity</dt>
				<dd>1</dd>
			</div>
			<div>
				<dt>Satisfies</dt>
				<dd>
					<span class="chip req">SYS-001</span> Flight endurance <Check size={14} class="ok" />
				</dd>
			</div>
		</dl>
		<p class="problem">
			<TriangleAlert size={15} />
			<span><code>Battery</code> has no <code>mass</code> attribute yet.</span>
			<span class="fix">Add one</span>
		</p>
	</figure>
</div>

<style>
	.concept {
		position: relative;
		display: grid;
		gap: var(--space-4);
	}
	figure {
		margin: 0;
	}
	code {
		font-size: 0.92em;
	}

	/* ── Keyword hover ─────────────────────────────────────────────────────── */
	.hover-card {
		position: relative;
		z-index: 1;
		max-width: 22rem;
	}
	.snippet {
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		font-family: var(--font-mono);
		font-size: 12.5px;
		line-height: 1.8;
		color: var(--syntax-name);
		overflow: hidden;
	}
	.snippet div {
		white-space: pre;
	}
	.snippet .in {
		padding-left: 4ch;
	}
	.k {
		color: var(--syntax-keyword);
		font-weight: 550;
	}
	.d {
		color: var(--syntax-definition);
		font-weight: 600;
	}
	.t {
		color: var(--syntax-type);
	}
	.o {
		color: var(--syntax-operator);
	}
	.hovered {
		background: var(--accent-weak);
		border-radius: 3px;
		box-shadow: 0 0 0 2px var(--accent-weak);
		text-decoration: underline dotted var(--syntax-keyword);
		text-underline-offset: 3px;
	}
	.tip {
		position: relative;
		margin: 0.6rem 0 0 2.25rem;
		padding: var(--space-3) var(--space-4);
		background: var(--text);
		color: var(--bg);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		font-size: var(--text-sm);
		line-height: 1.5;
		max-width: 18.5rem;
	}
	.tip::before {
		content: '';
		position: absolute;
		top: -5px;
		left: 1.6rem;
		width: 10px;
		height: 10px;
		background: inherit;
		transform: rotate(45deg);
	}
	.tip-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.2rem;
		font-weight: 600;
	}
	.tip-head span {
		font-weight: 500;
		opacity: 0.8;
	}

	/* ── Inspector ─────────────────────────────────────────────────────────── */
	.inspector {
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-sm);
		color: var(--kind-structure);
		background: color-mix(in srgb, var(--kind-structure) 13%, var(--surface));
	}
	.title {
		font-weight: 650;
		font-size: var(--text-lg);
		letter-spacing: -0.01em;
	}
	.stereo {
		color: var(--text-3);
		font-weight: 500;
		font-size: var(--text-sm);
	}
	.kind {
		color: var(--kind-structure);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.summary {
		margin-top: var(--space-4);
		font-size: var(--text-lg);
		line-height: 1.55;
	}
	.analogy {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.analogy :global(svg) {
		flex: none;
		margin-top: 0.15rem;
		color: var(--warn);
	}
	.props {
		margin: var(--space-4) 0 0;
		border-top: 1px solid var(--border);
	}
	.props div {
		display: grid;
		grid-template-columns: 7.5rem 1fr;
		gap: var(--space-3);
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--border);
		font-size: var(--text-md);
	}
	dt {
		color: var(--text-3);
	}
	dd {
		margin: 0;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chip {
		padding: 0 0.45rem;
		border-radius: 4px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.5rem;
		border: 1px solid;
	}
	.chip.def {
		color: var(--kind-structure);
		border-color: color-mix(in srgb, var(--kind-structure) 35%, transparent);
	}
	.chip.req {
		color: var(--kind-requirement);
		border-color: color-mix(in srgb, var(--kind-requirement) 35%, transparent);
	}
	dd :global(.ok) {
		color: var(--ok);
	}
	.problem {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--warn-weak);
		color: var(--text);
		font-size: var(--text-sm);
	}
	.problem :global(svg) {
		color: var(--warn);
		flex: none;
	}
	.problem > span:first-of-type {
		flex: 1;
		min-width: 12rem;
	}
	.fix {
		padding: 0.15rem 0.6rem;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		font-size: var(--text-xs);
	}

	@media (max-width: 30rem) {
		.inspector {
			padding: var(--space-4);
		}
		.props div {
			grid-template-columns: 6.25rem 1fr;
		}
	}
	@media (min-width: 40rem) {
		.inspector {
			margin-left: 3.5rem;
		}
	}
</style>
