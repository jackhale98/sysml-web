<script lang="ts">
	import type { StateMachine } from '#lib/engine/types.ts';
	import {
		coerce,
		formatValue,
		inputKind,
		sliderRange,
		variableUses,
		type InputKind
	} from './model.ts';

	interface Props {
		machine: StateMachine;
		/** Values in the current session. */
		values: Record<string, unknown>;
		/** Values changed since the last step. */
		pending: Record<string, unknown>;
		/** Ready (true) or blocked (false) state of the transitions leaving the current state. */
		readiness: Map<number, 'ready' | 'waiting' | 'blocked'>;
		onchange: (name: string, value: unknown) => void;
		onreset: (name: string) => void;
		onhover: (indices: number[]) => void;
		ontransition: (index: number) => void;
	}

	let { machine, values, pending, readiness, onchange, onreset, onhover, ontransition }: Props =
		$props();

	const uid = $props.id();
	const uses = $derived(variableUses(machine));
	let flashed = $state<string | null>(null);

	const rows = $derived(
		machine.variables.map((v) => {
			const kind = inputKind(v);
			return { v, kind, range: sliderRange(machine, v.name, kind) };
		})
	);

	const valueOf = (name: string) => (name in pending ? pending[name] : values[name]);

	/** Focus a variable's input (from a blocked event's "has no value yet"). */
	export function focus(name: string) {
		const el = document.getElementById(`${uid}-${name}`);
		el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		el?.focus({ preventScroll: true });
		flashed = name;
		setTimeout(() => (flashed = null), 1200);
	}

	function set(name: string, kind: InputKind, raw: string | boolean) {
		onchange(name, coerce(kind, raw));
	}

	function numberText(value: unknown) {
		return typeof value === 'number' ? String(Math.round(value * 1e6) / 1e6) : '';
	}
</script>

{#if rows.length}
	<ul class="vars">
		{#each rows as { v, kind, range } (v.name)}
			{@const value = valueOf(v.name)}
			{@const changed = v.name in pending}
			{@const affects = uses.get(v.name) ?? []}
			<li
				class="var"
				class:changed
				class:flashed={flashed === v.name}
				onpointerenter={() => onhover(affects.map((u) => u.index))}
				onpointerleave={() => onhover([])}
				onfocusin={() => onhover(affects.map((u) => u.index))}
				onfocusout={() => onhover([])}
			>
				<div class="top">
					<label for="{uid}-{v.name}">
						<span class="name">{v.name}</span>
						{#if v.type || v.direction}
							<span class="meta">
								{#if v.type}<span class="type">{v.type}</span>{/if}
								{#if v.direction}<span class="dir">{v.direction}</span>{/if}
								{#if kind === 'boolean'}
									<span class="switch-text"
										>{value === null || value === undefined
											? 'unset'
											: value
												? 'true'
												: 'false'}</span
									>
								{/if}
							</span>
						{/if}
					</label>
					{#if kind === 'boolean'}
						<span class="switch-wrap">
							<input
								id="{uid}-{v.name}"
								class="switch"
								type="checkbox"
								role="switch"
								checked={value === true}
								onchange={(e) => set(v.name, kind, e.currentTarget.checked)}
							/>
						</span>
					{/if}
				</div>
				{#if kind === 'real' || kind === 'integer'}
					<div class="numeric">
						{#if range}
							<input
								class="slider"
								type="range"
								min={range.min}
								max={range.max}
								step={range.step}
								value={typeof value === 'number' ? value : range.min}
								aria-label="{v.name} slider"
								style:--fill="{(((typeof value === 'number' ? value : range.min) - range.min) /
									(range.max - range.min)) *
									100}%"
								oninput={(e) => set(v.name, kind, e.currentTarget.value)}
							/>
						{/if}
						<input
							id="{uid}-{v.name}"
							class="number"
							type="number"
							inputmode="decimal"
							step={kind === 'integer' ? 1 : (range?.step ?? 'any')}
							placeholder="unset"
							value={numberText(value)}
							onchange={(e) => set(v.name, kind, e.currentTarget.value)}
						/>
					</div>
				{:else if kind === 'text'}
					<input
						id="{uid}-{v.name}"
						class="text"
						type="text"
						placeholder="unset"
						value={typeof value === 'string' ? value : value == null ? '' : String(value)}
						onchange={(e) => set(v.name, kind, e.currentTarget.value)}
					/>
				{/if}
				{#if changed}
					<p class="note">
						<span>Was {formatValue(values[v.name])}; applies on the next step or event.</span>
						<button type="button" class="undo" onclick={() => onreset(v.name)}>Undo</button>
					</p>
				{/if}
				{#if v.doc}<p class="doc">{v.doc}</p>{/if}
				{#if affects.length}
					<div class="uses">
						<span class="uses-label">Affects</span>
						{#each affects as use (use.index + use.kind)}
							{@const state = readiness.get(use.index)}
							<button
								type="button"
								class="use {state ?? ''}"
								title="{use.kind === 'when' ? 'change trigger' : 'guard'}: {use.expression}"
								onclick={() => ontransition(use.index)}
							>
								<span class="use-kind">{use.kind === 'when' ? 'when' : 'if'}</span>
								{use.name}
								{#if state}<span class="dot" aria-hidden="true"></span>{/if}
								<span class="visually-hidden"
									>: {use.expression}{state === 'ready'
										? ', ready now'
										: state === 'waiting'
											? ', waiting for its time'
											: state === 'blocked'
												? ', blocked now'
												: ''}</span
								>
							</button>
						{/each}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="empty">This machine has no attributes to set.</p>
{/if}

<style>
	.vars {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.var {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition:
			border-color 200ms var(--ease),
			box-shadow 200ms var(--ease);
	}
	.var:hover {
		border-color: var(--border-strong);
	}
	.var.changed {
		border-color: color-mix(in oklab, var(--warn) 55%, var(--border));
		background: color-mix(in oklab, var(--warn-weak) 55%, var(--surface));
	}
	.var.flashed {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-weak);
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 24px;
	}
	label {
		display: grid;
		gap: 1px;
		min-width: 0;
	}
	.name {
		font-family: var(--font-mono);
		font-size: 12.5px;
		font-weight: 650;
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.type,
	.dir {
		color: var(--text-2);
		font-size: 11px;
	}
	.type {
		color: var(--syntax-type);
	}
	.dir {
		padding: 0 5px;
		background: var(--surface-2);
		border-radius: var(--radius-pill);
	}

	.switch-wrap {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.switch-text {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.switch {
		appearance: none;
		position: relative;
		flex: none;
		width: 40px;
		height: 24px;
		margin: 0;
		background: var(--border-strong);
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition: background-color 160ms var(--ease);
	}
	.switch::before {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 18px;
		height: 18px;
		background: var(--surface);
		border-radius: 50%;
		box-shadow: var(--shadow-sm);
		transition: translate 160ms var(--ease);
	}
	.switch:checked {
		background: var(--ok);
	}
	.switch:checked::before {
		translate: 16px 0;
	}
	/* A bigger hit area on touch without changing the look. */
	.switch::after {
		content: '';
		position: absolute;
		inset: -10px -4px;
	}

	.numeric {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.slider {
		flex: 1;
		min-width: 0;
		height: 28px;
		margin: 0;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}
	.slider::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 3px;
		background: linear-gradient(
			to right,
			var(--accent) var(--fill),
			var(--border-strong) var(--fill)
		);
	}
	.slider::-moz-range-track {
		height: 6px;
		border-radius: 3px;
		background: var(--border-strong);
	}
	.slider::-moz-range-progress {
		height: 6px;
		border-radius: 3px;
		background: var(--accent);
	}
	.slider::-webkit-slider-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		margin-top: -7px;
		background: var(--surface);
		border: 2px solid var(--accent);
		border-radius: 50%;
		box-shadow: var(--shadow-sm);
	}
	.slider::-moz-range-thumb {
		width: 16px;
		height: 16px;
		background: var(--surface);
		border: 2px solid var(--accent);
		border-radius: 50%;
	}
	.number,
	.text {
		height: 32px;
		padding: 0 8px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 12.5px;
	}
	.number {
		flex: none;
		width: 84px;
		font-variant-numeric: tabular-nums;
	}
	.numeric:not(:has(.slider)) .number,
	.text {
		width: 100%;
	}
	.number::placeholder,
	.text::placeholder {
		color: var(--text-3);
	}

	.note {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		color: var(--warn);
		font-size: 11.5px;
		line-height: 1.35;
	}
	.undo {
		flex: none;
		padding: 2px 8px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		font-size: 11.5px;
		cursor: pointer;
	}
	.doc {
		color: var(--text-2);
		font-size: 12px;
		line-height: 1.4;
	}
	.uses {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.uses-label {
		margin-right: 2px;
		color: var(--text-3);
		font-size: 11px;
	}
	.use {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 24px;
		padding: 0 8px;
		color: var(--text);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font-family: var(--font-mono);
		font-size: 11px;
		cursor: pointer;
	}
	.use:hover {
		border-color: var(--accent);
	}
	.use-kind {
		color: var(--syntax-keyword);
		font-style: italic;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-3);
	}
	.use.ready .dot {
		background: var(--ok);
	}
	.use.blocked .dot {
		background: transparent;
		border: 1.5px solid var(--text-3);
	}
	.empty {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
