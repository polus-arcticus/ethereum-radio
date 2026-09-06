import {describe, it} from 'node:test';
import {expect} from 'earl';
import {
	mergeSpan,
	liveSpan,
	earliestSpan,
	spanNear,
	cellStates,
	subtractSpan,
} from '../../src/core/spans.ts';

describe('mergeSpan', () => {
	it('adds a disjoint span without merging', () => {
		const result = mergeSpan([{fromBlock: 100n, toBlock: 200n}], {
			fromBlock: 300n,
			toBlock: 400n,
		});
		expect(result).toEqual([
			{fromBlock: 100n, toBlock: 200n},
			{fromBlock: 300n, toBlock: 400n},
		]);
	});

	it('merges an overlapping span', () => {
		const result = mergeSpan([{fromBlock: 100n, toBlock: 200n}], {
			fromBlock: 150n,
			toBlock: 250n,
		});
		expect(result).toEqual([{fromBlock: 100n, toBlock: 250n}]);
	});

	it('merges a touching span (adjacent, no gap)', () => {
		const result = mergeSpan([{fromBlock: 100n, toBlock: 200n}], {
			fromBlock: 201n,
			toBlock: 300n,
		});
		expect(result).toEqual([{fromBlock: 100n, toBlock: 300n}]);
	});

	it('does not merge across a one-block gap', () => {
		const result = mergeSpan([{fromBlock: 100n, toBlock: 200n}], {
			fromBlock: 202n,
			toBlock: 300n,
		});
		expect(result).toEqual([
			{fromBlock: 100n, toBlock: 200n},
			{fromBlock: 202n, toBlock: 300n},
		]);
	});

	it('bridges two existing spans when the new span touches both', () => {
		const spans = [
			{fromBlock: 100n, toBlock: 200n},
			{fromBlock: 301n, toBlock: 400n},
		];
		const result = mergeSpan(spans, {fromBlock: 201n, toBlock: 300n});
		expect(result).toEqual([{fromBlock: 100n, toBlock: 400n}]);
	});

	it('is order-independent (out-of-order scanning is safe)', () => {
		const spans = [{fromBlock: 500n, toBlock: 600n}];
		const a = mergeSpan(mergeSpan(spans, {fromBlock: 300n, toBlock: 400n}), {
			fromBlock: 401n,
			toBlock: 499n,
		});
		const b = mergeSpan(mergeSpan(spans, {fromBlock: 401n, toBlock: 499n}), {
			fromBlock: 300n,
			toBlock: 400n,
		});
		expect(a).toEqual([{fromBlock: 300n, toBlock: 600n}]);
		expect(b).toEqual(a);
	});
});

describe('liveSpan / earliestSpan', () => {
	it('return undefined for an empty list', () => {
		expect(liveSpan([])).toEqual(undefined);
		expect(earliestSpan([])).toEqual(undefined);
	});

	it('pick the span reaching furthest toward the tip / with the lowest fromBlock', () => {
		const spans = [
			{fromBlock: 500n, toBlock: 600n},
			{fromBlock: 100n, toBlock: 200n},
		];
		expect(liveSpan(spans)).toEqual({fromBlock: 500n, toBlock: 600n});
		expect(earliestSpan(spans)).toEqual({fromBlock: 100n, toBlock: 200n});
	});
});

describe('spanNear', () => {
	it('returns undefined for an empty list', () => {
		expect(spanNear([], 150n)).toEqual(undefined);
	});

	it('returns the containing span', () => {
		const spans = [
			{fromBlock: 100n, toBlock: 200n},
			{fromBlock: 500n, toBlock: 600n},
		];
		expect(spanNear(spans, 150n)).toEqual({fromBlock: 100n, toBlock: 200n});
	});

	it('returns undefined when the block is not contained in any span (no closest-match fallback)', () => {
		const spans = [
			{fromBlock: 100n, toBlock: 200n},
			{fromBlock: 500n, toBlock: 600n},
		];
		expect(spanNear(spans, 450n)).toEqual(undefined);
		expect(spanNear(spans, 250n)).toEqual(undefined);
	});
});

describe('cellStates', () => {
	it('tags each blockRangeLimit window as scanned or not', () => {
		const spans = [{fromBlock: 100n, toBlock: 109n}];
		const cells = cellStates(spans, 100n, 129n, 10n);
		expect(cells).toEqual([
			{fromBlock: 100n, toBlock: 109n, scanned: true},
			{fromBlock: 110n, toBlock: 119n, scanned: false},
			{fromBlock: 120n, toBlock: 129n, scanned: false},
		]);
	});

	it('clips the final cell at tip when the range is not an exact multiple', () => {
		const cells = cellStates([], 100n, 124n, 10n);
		expect(cells.map((c) => [c.fromBlock, c.toBlock])).toEqual([
			[100n, 109n],
			[110n, 119n],
			[120n, 124n],
		]);
	});

	it('returns an empty list when tip is before floor', () => {
		expect(cellStates([], 200n, 100n, 10n)).toEqual([]);
	});
});

describe('subtractSpan', () => {
	it('removes a span that exactly matches an existing one', () => {
		const result = subtractSpan([{fromBlock: 100n, toBlock: 200n}], {
			fromBlock: 100n,
			toBlock: 200n,
		});
		expect(result).toEqual([]);
	});

	it('splits a span that fully contains the removed range in two', () => {
		const result = subtractSpan([{fromBlock: 100n, toBlock: 300n}], {
			fromBlock: 150n,
			toBlock: 199n,
		});
		expect(result).toEqual([
			{fromBlock: 100n, toBlock: 149n},
			{fromBlock: 200n, toBlock: 300n},
		]);
	});

	it('trims the front of a span when the removed range overlaps its start', () => {
		const result = subtractSpan([{fromBlock: 100n, toBlock: 300n}], {
			fromBlock: 50n,
			toBlock: 199n,
		});
		expect(result).toEqual([{fromBlock: 200n, toBlock: 300n}]);
	});

	it('trims the tail of a span when the removed range overlaps its end', () => {
		const result = subtractSpan([{fromBlock: 100n, toBlock: 300n}], {
			fromBlock: 200n,
			toBlock: 400n,
		});
		expect(result).toEqual([{fromBlock: 100n, toBlock: 199n}]);
	});

	it('leaves disjoint spans untouched', () => {
		const spans = [
			{fromBlock: 100n, toBlock: 200n},
			{fromBlock: 500n, toBlock: 600n},
		];
		const result = subtractSpan(spans, {fromBlock: 300n, toBlock: 400n});
		expect(result).toEqual(spans);
	});
});
