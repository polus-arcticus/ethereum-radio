// A sparse representation of "what block ranges have we already scanned" for
// a given scan target (e.g. one contract address + topic filter on one
// chain). Lets a client resume scanning from wherever it left off, and
// supports a second, disjoint region (an atBlock-anchored forward scan) that
// hasn't yet met the tip-tailed region.
export interface Span {
	fromBlock: bigint;
	toBlock: bigint;
}

const byFromBlock = (a: Span, b: Span) =>
	a.fromBlock < b.fromBlock ? -1 : a.fromBlock > b.fromBlock ? 1 : 0;

// Insert/extend by one span and coalesce with anything it now overlaps or
// touches (gap of zero blocks between them). Keeps the result sorted by
// fromBlock. Order of insertion never matters — out-of-order scanning (e.g.
// clicking an arbitrary cell in the scan-map UI) is always safe.
export const mergeSpan = (spans: Span[], span: Span): Span[] => {
	const merged: Span = {...span};
	const rest: Span[] = [];

	for (const existing of spans) {
		const touchesOrOverlaps =
			existing.fromBlock <= merged.toBlock + 1n &&
			existing.toBlock >= merged.fromBlock - 1n;
		if (touchesOrOverlaps) {
			merged.fromBlock =
				merged.fromBlock < existing.fromBlock
					? merged.fromBlock
					: existing.fromBlock;
			merged.toBlock =
				merged.toBlock > existing.toBlock ? merged.toBlock : existing.toBlock;
		} else {
			rest.push(existing);
		}
	}

	return [...rest, merged].sort(byFromBlock);
};

// The span reaching furthest toward the tip — the one automatic tip-tailing
// sync extends every run.
export const liveSpan = (spans: Span[]): Span | undefined =>
	spans.length
		? spans.reduce((a, b) => (b.toBlock > a.toBlock ? b : a))
		: undefined;

// The span with the lowest fromBlock — the one "scan backwards" extends
// downward.
export const earliestSpan = (spans: Span[]): Span | undefined =>
	spans.length
		? spans.reduce((a, b) => (b.fromBlock < a.fromBlock ? b : a))
		: undefined;

// The span that already covers a given block, if any. Used to find (or know
// we must create) the span an atBlock-seeded forward walk should extend, and
// to answer "has that walk already merged into the live span?"
// (spanNear(spans, atBlock) === liveSpan(spans)).
//
// Deliberately strict containment, not "nearest span" — a forward walk from
// atBlock always starts a span whose fromBlock is at-or-before atBlock and
// only grows upward, so once it exists it always contains atBlock. Falling
// back to the closest span when none contains the block would wrongly match
// an unrelated span (e.g. the tip-tailed live span, however far from atBlock
// it is) and report a forward walk as "already merged" before it ever
// started.
export const spanNear = (spans: Span[], block: bigint): Span | undefined =>
	spans.find((s) => s.fromBlock <= block && block <= s.toBlock);

// Every blockRangeLimit-sized window between floor and tip, tagged with
// whether it's fully covered by an existing span. Pure derived data — the
// ground truth a scan-map UI buckets/renders from.
export interface Cell {
	fromBlock: bigint;
	toBlock: bigint;
	scanned: boolean;
}

export const cellStates = (
	spans: Span[],
	floor: bigint,
	tip: bigint,
	blockRangeLimit: bigint,
): Cell[] => {
	if (blockRangeLimit <= 0n || tip < floor) return [];

	const cells: Cell[] = [];
	for (let from = floor; from <= tip; from += blockRangeLimit) {
		const windowEnd = from + blockRangeLimit - 1n;
		const to = windowEnd > tip ? tip : windowEnd;
		const scanned = spans.some((s) => s.fromBlock <= from && s.toBlock >= to);
		cells.push({fromBlock: from, toBlock: to, scanned});
	}
	return cells;
};
