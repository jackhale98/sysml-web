/**
 * A seedable pseudo-random number generator, so a Monte Carlo run gives
 * the same numbers every time it is made with the same seed.
 *
 * The generator is sfc32 (Chris Doty-Humphrey's small fast counter, 128
 * bits of state, passes PractRand to 2^40 bytes and more), seeded through
 * splitmix32. A *stream* name (an uncertain value's path,
 * `DroneArchitecture::drone::battery::mass`) is hashed into the seed, so
 * each value draws from its own sequence: the samples of a value don't
 * depend on which other values a run includes or in what order, and two
 * runs that share a value see the same samples of it (a budget's row and
 * the check on the same total agree to the last digit).
 */

/** FNV-1a, 32 bits: a stream name as a number. */
export function hashText(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export class Random {
	private a: number;
	private b: number;
	private c: number;
	private d: number;

	constructor(seed: number, stream = '') {
		// splitmix32 spreads the seed and the stream over the four words of state.
		let s = (Math.trunc(seed) ^ hashText(stream)) >>> 0;
		const next = () => {
			s = (s + 0x9e3779b9) >>> 0;
			let z = s;
			z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
			z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
			return (z ^ (z >>> 16)) >>> 0;
		};
		this.a = next();
		this.b = next();
		this.c = next();
		this.d = next();
		// Discard the first outputs, as the generator's author advises.
		for (let i = 0; i < 12; i++) this.uint32();
	}

	/** The next 32 random bits, as an unsigned integer. */
	uint32(): number {
		const t = (((this.a + this.b) | 0) + this.d) | 0;
		this.d = (this.d + 1) | 0;
		this.a = this.b ^ (this.b >>> 9);
		this.b = (this.c + (this.c << 3)) | 0;
		this.c = (this.c << 21) | (this.c >>> 11);
		this.c = (this.c + t) | 0;
		return t >>> 0;
	}

	/**
	 * A number in (0, 1), never 0 or 1 exactly (the middle of one of 2^32
	 * equal steps), so a quantile function never sees an end it can't map.
	 */
	next(): number {
		return (this.uint32() + 0.5) / 4294967296;
	}

	/** A whole number from 0 to n − 1. */
	below(n: number): number {
		return Math.floor(this.next() * n);
	}
}
