import type {RawLog} from '../adapters/types.ts';
import {createCursor, type Cursor, type CursorConfig} from './cursor.ts';

export interface RadioOptions {
	/** Delay between live-tail sync() polls once history is fully replayed. */
	pollIntervalMs?: number;
	signal?: AbortSignal;
}

const DEFAULT_POLL_INTERVAL_MS = 4_000;

// Resolves after `ms`, or immediately if `signal` is already (or becomes)
// aborted — the {signal} convention Helia's own APIs use, kept for
// consistency with the IPFS layer this generator is meant to sit next to.
const abortableDelay = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal?.addEventListener('abort', onAbort, {once: true});
	});

// Turns a Cursor's one-shot fetchHistory()/sync() calls into a single feed:
// replay the past in blockRangeLimit-sized chunks, then keep tailing the tip
// forever. Pull-based (the standard `for await...of` protocol) rather than
// push-based (RxJS) so it composes without forcing a dependency on
// consumers, and so `break`ing the loop (or aborting `signal`) cleanly stops
// it — no subscribe/unsubscribe lifecycle to manage.
export async function* radio(
	cursor: Cursor,
	options: RadioOptions = {},
): AsyncGenerator<RawLog[]> {
	const {pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, signal} = options;

	// sync() first, not fetchHistory(): fetchHistory() only ever walks
	// backward, and against an empty store its first window stops short of
	// the real chain tip (only sync() reaches the actual tip). Without this,
	// isFullyScanned() could go true — once the backward walk reaches
	// floorBlock — while a window near the tip was never scanned at all.
	// Also what re-closes the gap opened between separate radio() runs
	// (a store from a previous session that already reached an older tip).
	const initial = await cursor.sync();
	if (initial.length) yield initial;

	while (!signal?.aborted && !(await cursor.isFullyScanned())) {
		const logs = await cursor.fetchHistory();
		if (logs.length) yield logs;
	}

	while (!signal?.aborted) {
		const logs = await cursor.sync();
		if (logs.length) yield logs;
		await abortableDelay(pollIntervalMs, signal);
	}
}

// A Cursor that's also directly streamable — the top-level entry point for
// most consumers. `for await (const logs of radio)` drives the same replay-
// then-tail loop as radio(cursor, options), while every Cursor method
// (isFullyScanned(), getCellStates(), fetchHistory() for manual control,
// etc.) stays available on the same object, so picking the stream doesn't
// mean giving up the imperative escape hatch. A plain factory (no `new`) to
// stay consistent with createCursor/createViemAdapter/createMemoryStore —
// this is the only object in the package that's both, everything else is
// either an imperative interface (Cursor) or a bare generator (radio()).
export interface Radio extends Cursor {
	[Symbol.asyncIterator](): AsyncGenerator<RawLog[]>;
}

export const createRadio = (
	config: CursorConfig,
	options: RadioOptions = {},
): Radio => {
	const cursor = createCursor(config);
	return {
		...cursor,
		[Symbol.asyncIterator]: () => radio(cursor, options),
	};
};
