# Explicit scanned-range tracking + proactive RPC range-limit detection

Context: we built `@ethereum-radio/indexer` (a small browser-side log-scanning
library, MIT) after evaluating etherfold for a similar use case and going a
different route on two specific pieces. Writing this up in case either is
useful upstream — happy to turn either into a PR against a stable branch, or
just leave this as a discussion if the architecture underneath is still
moving.

## 1. Track fully-scanned ranges explicitly, not just event-bearing blocks

**Problem.** From `CONTEXT.md`: the stream/state cursor model holds a sparse
list of blocks that actually contained matching logs, plus ordinal-indexed
raw-log segments. There's no record of "we scanned `[a, b]` and found
nothing" — only "here are the blocks in `[a, b]` that had something." The doc
already calls out the resulting fragility: a reorg below the lowest block
currently held can silently invalidate a "fully covered below X" claim,
because there's no explicit lower bound on what was actually scanned versus
what merely happened to contain a match.

**Proposal.** A tiny, storage-agnostic interval-set sitting alongside (not
replacing) the existing stream/state cursors: a sorted list of
`{fromBlock, toBlock}` spans representing ranges that were actually queried
via `eth_getLogs`, regardless of whether anything matched. Three operations
are enough to make it useful:

- `mergeSpan(spans, newSpan)` — insert a range, coalescing on overlap/adjacency.
  Order-independent, so scanning out of sequence (backfill, then live-tail,
  then someone clicks an arbitrary gap) is always safe to merge.
- `earliestSpan(spans)` / `liveSpan(spans)` — the two spans a backward
  backfill and a forward/live-tail walk each extend.
- A `cellStates(spans, floor, tip, windowSize)` projection that buckets
  `[floor, tip]` into fixed-size windows and marks each `scanned`/not — this
  is what a scan-progress UI renders directly, and it falls out of the span
  list for free.

This directly patches the reorg-below-lowest-held-block gap: "fully scanned"
becomes `earliestSpan.fromBlock <= floorBlock`, a single explicit check
against real scanned ranges, independent of whether those ranges happened to
contain events. It's ~80 lines with zero dependencies (our implementation:
`ethereum-radio/src/core/spans.ts`, if a concrete reference is useful) and
composes with any storage backend — it's just another small record next to
the stream cursor and state cursor.

## 2. Proactively probe the real `eth_getLogs` range cap, instead of reacting to truncation

**Problem.** The current approach (`suspectResultCount`, default 10,000) is
reactive: fetch, and if the count comes back exactly at the cap, assume
truncation and halve the range for a retry. That's a reasonable fallback, but
it means every session against an RPC with a low real cap (some public
endpoints cap `eth_getLogs` at 5-10 blocks) pays for at least one wasted
request-and-retry before converging, and the binary-search-by-halving still
has to re-discover the same limit on every fresh session against that RPC
unless the discovered range is itself cached somewhere.

**Proposal.** An opt-in probe that runs once (cacheable per RPC endpoint):
try a candidate range width from a small descending list
(`[2_000_000, 500_000, 100_000, 50_000, 10_000, 5_000, 1_000, 500, 100, 10,
5, 1]`), call `getLogs` at that width, and take the first that succeeds as
the empirical cap. Apply a safety margin below that (we use a golden-ratio
based one, `~0.618` of the detected max) rather than the raw detected value,
since the true limit may be approximate or itself rate-limit-driven rather
than a hard, stable cutoff. This is a complement to the existing
retry-and-shrink logic, not a replacement — retry-and-shrink is still the
right fallback for a range that passed the probe but fails anyway (rate
limiting, load-balanced backend with inconsistent limits across nodes).

Reference: `ethereum-radio/src/core/rpc-doctor.ts` (`detectRpcCapabilities`,
`safeBlockRangeLimit`).

## Why now / why us

We hit both of these designing a resumable client-side scanner for our own
use case (no backend indexer, scan progress persisted in the browser) and
ended up building small, dependency-free modules for them rather than adopting
an existing library. Given etherfold is heading in a very similar direction
(client-side indexing, swappable storage backends), it seemed worth checking
whether either piece is worth folding in rather than each project maintaining
its own version. No pressure either way — flagging this as a discussion
first since the storage/cursor layer looks like it's still under active
redesign (generation model, stream/state split) and a cold PR against that
felt more likely to conflict than help.
