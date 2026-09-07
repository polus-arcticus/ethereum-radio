import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {GetLogsParams, LogsProvider, RawLog} from '../adapters/types.ts';
import {createCursor, type ReorgCheckResult} from '../core/cursor.ts';
import type {Checkpoint} from '../core/checkpoints.ts';
import type {Cell, Span} from '../core/spans.ts';
import type {SpanStore, Store} from '../storage/types.ts';

export interface UseCursorArgs {
	provider: LogsProvider;
	store: SpanStore;
	/** Storage key, caller-owned (e.g. `${chainId}:${address}:${topic0}`). */
	key: string;
	address: GetLogsParams['address'];
	topics?: GetLogsParams['topics'];
	/** A floor below which logs can't exist (e.g. contract deployment block). */
	floorBlock: bigint;
	blockRangeLimit: bigint;
	/** Optional multiplier (0–1] shrinking the scan window below blockRangeLimit — see CursorConfig. Default: 1.0 (no padding). */
	safetyPadding?: number;
	/** Optional forward-scan anchor — enables fetchForward() extending from a known block. */
	atBlock?: bigint;
	/** If set, re-runs the tip-tailing sync on this interval (ms). Default: no polling. */
	pollIntervalMs?: number;
	/** Required for checkForReorg() — see CursorConfig. */
	checkpointStore?: Store<Checkpoint[]>;
}

export interface UseCursorResult {
	scannedSpans: Span[];
	cellStates: Cell[];
	isFullyScanned: boolean;
	isLoading: boolean;
	error: Error | undefined;
	tip: bigint | undefined;
	scanRange: (fromBlock: bigint, toBlock: bigint) => Promise<RawLog[]>;
	fetchHistory: () => Promise<RawLog[]>;
	fetchForward: () => Promise<RawLog[]>;
	checkForReorg: (fromBlock: bigint, toBlock: bigint) => Promise<ReorgCheckResult | undefined>;
	refresh: () => Promise<void>;
}

// A thin React binding over the framework-agnostic Cursor engine. No
// react-query/caching layer — plain useState/useEffect. A consumer wanting
// request de-duplication across multiple useCursor call sites pointed at the
// same key should reach for a real query-cache library on top of this.
export const useCursor = (args: UseCursorArgs): UseCursorResult => {
	const {
		provider,
		store,
		key,
		address,
		floorBlock,
		blockRangeLimit,
		safetyPadding,
		atBlock,
		pollIntervalMs,
	} = args;
	// Arrays/objects (address, topics) can't safely sit in a dep array by
	// reference — stringify them so a new-but-equal array doesn't churn the
	// memoized cursor (or re-trigger the sync effect) every render.
	const topicsKey = JSON.stringify(args.topics ?? null);
	const addressKey = JSON.stringify(address);

	const {checkpointStore} = args;
	const cursor = useMemo(
		() =>
			createCursor({
				provider,
				store,
				key,
				address,
				topics: args.topics,
				floorBlock,
				blockRangeLimit,
				safetyPadding,
				atBlock,
				checkpointStore,
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			provider,
			store,
			key,
			addressKey,
			topicsKey,
			floorBlock,
			blockRangeLimit,
			safetyPadding,
			atBlock,
			checkpointStore,
		],
	);

	const [scannedSpans, setScannedSpans] = useState<Span[]>([]);
	const [tip, setTip] = useState<bigint>();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<Error>();
	const mountedRef = useRef(true);
	useEffect(
		() => () => {
			mountedRef.current = false;
		},
		[],
	);

	const refreshState = useCallback(async () => {
		const spans = await cursor.getScannedSpans();
		if (mountedRef.current) setScannedSpans(spans);
	}, [cursor]);

	const run = useCallback(
		async <T,>(action: () => Promise<T>, fallback: T): Promise<T> => {
			setIsLoading(true);
			setError(undefined);
			try {
				const result = await action();
				await refreshState();
				return result;
			} catch (e) {
				if (mountedRef.current)
					setError(e instanceof Error ? e : new Error(String(e)));
				return fallback;
			} finally {
				if (mountedRef.current) setIsLoading(false);
			}
		},
		[refreshState],
	);

	const refresh = useCallback(async () => {
		const newTip = await provider.getBlockNumber();
		if (mountedRef.current) setTip(newTip);
		await run(() => cursor.sync(), []);
	}, [provider, cursor, run]);

	const scanRange = useCallback(
		(fromBlock: bigint, toBlock: bigint) =>
			run(() => cursor.scanRange(fromBlock, toBlock), []),
		[run, cursor],
	);
	const fetchHistory = useCallback(
		() => run(() => cursor.fetchHistory(), []),
		[run, cursor],
	);
	const fetchForward = useCallback(
		() => run(() => cursor.fetchForward(), []),
		[run, cursor],
	);
	// Resolves to undefined (rather than throwing into the caller) on error,
	// same as the other actions here — check `error` for details. Requires
	// `checkpointStore` in UseCursorArgs; see Cursor.checkForReorg().
	const checkForReorg = useCallback(
		(fromBlock: bigint, toBlock: bigint) =>
			run(() => cursor.checkForReorg(fromBlock, toBlock), undefined),
		[run, cursor],
	);

	// Initial tip-tailing scan on mount (and whenever the cursor identity
	// changes, e.g. a different key/address). Optionally repeats on an
	// interval as a simple, adapter-agnostic substitute for a live push
	// subscription (which would need a watch-capable provider — out of scope
	// for the framework-agnostic core, see core/cursor.ts).
	useEffect(() => {
		void refresh();
		if (pollIntervalMs == null) return;
		const interval = setInterval(() => void refresh(), pollIntervalMs);
		return () => clearInterval(interval);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cursor, pollIntervalMs]);

	const [cells, setCells] = useState<Cell[]>([]);
	const [fullyScanned, setFullyScanned] = useState(false);
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const currentTip = tip ?? (await provider.getBlockNumber());
			const [nextCells, nextFullyScanned] = await Promise.all([
				cursor.getCellStates(currentTip),
				cursor.isFullyScanned(),
			]);
			if (!cancelled) {
				setCells(nextCells);
				setFullyScanned(nextFullyScanned);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [cursor, scannedSpans, tip, provider]);

	return {
		scannedSpans,
		cellStates: cells,
		isFullyScanned: fullyScanned,
		isLoading,
		error,
		tip,
		scanRange,
		fetchHistory,
		fetchForward,
		checkForReorg,
		refresh,
	};
};
