import type {GetLogsParams, LogsProvider, RawLog} from '../adapters/types.ts';
import type {SpanStore} from '../storage/types.ts';
import {
	cellStates,
	earliestSpan,
	liveSpan,
	mergeSpan,
	spanNear,
	type Cell,
	type Span,
} from './spans.ts';
import {chunkedFetchLogs, clampFromBlock} from './chunked-logs.ts';

export interface CursorConfig {
	provider: LogsProvider;
	store: SpanStore;
	/** Storage key, caller-owned (e.g. `${chainId}:${address}:${topic0}`). */
	key: string;
	address: string | string[];
	topics?: (string | string[] | null)[];
	/** A floor below which logs can't exist (e.g. contract deployment block). */
	floorBlock: bigint;
	blockRangeLimit: bigint;
	/** Optional forward-scan anchor — enables fetchForward()/sync() extending from a known block. */
	atBlock?: bigint;
}

export interface Cursor {
	scanRange(fromBlock: bigint, toBlock: bigint): Promise<RawLog[]>;
	/** Extend from wherever the live span currently ends toward the chain tip, seeding a shallow initial window if nothing has been scanned yet. */
	sync(): Promise<RawLog[]>;
	/** Extend the earliest known span one blockRangeLimit window further back. */
	fetchHistory(): Promise<RawLog[]>;
	/** Extend the atBlock-anchored span one blockRangeLimit window forward, toward the live span. */
	fetchForward(): Promise<RawLog[]>;
	getScannedSpans(): Promise<Span[]>;
	getCellStates(tip: bigint): Promise<Cell[]>;
	isFullyScanned(): Promise<boolean>;
	getLiveSpan(): Promise<Span | undefined>;
	getEarliestSpan(): Promise<Span | undefined>;
}

const min = (...values: bigint[]): bigint =>
	values.reduce((a, b) => (b < a ? b : a));

// A framework-agnostic engine composing a LogsProvider + SpanStore +
// span/chunked-log primitives into the cursor algorithm. No caching between
// calls — every method re-reads store.load(key) fresh rather than trusting
// possibly-stale state, trading a little redundant I/O for correctness under
// concurrent callers (e.g. fetchHistory() and fetchForward() both in flight).
//
// Deliberately excludes any live-subscription/watch mechanism — that needs a
// watch-capable provider and lifecycle management, both framework/adapter
// specific, so it belongs in a React hook (as polling) or a future optional
// LogsProvider.watch?(), not here.
export const createCursor = (config: CursorConfig): Cursor => {
	const {
		provider,
		store,
		key,
		address,
		topics,
		floorBlock,
		blockRangeLimit,
		atBlock,
	} = config;

	const loadSpans = async (): Promise<Span[]> => (await store.load(key)) ?? [];

	const scanRange = async (
		fromBlock: bigint,
		toBlock: bigint,
	): Promise<RawLog[]> => {
		if (toBlock < fromBlock) return [];

		const spans = await loadSpans();
		const params: GetLogsParams = {address, topics, fromBlock, toBlock};
		const logs = await chunkedFetchLogs(provider, params, blockRangeLimit);
		const newSpans = mergeSpan(spans, {fromBlock, toBlock});
		await store.save(key, newSpans);
		return logs;
	};

	const sync = async (): Promise<RawLog[]> => {
		const spans = await loadSpans();
		const live = liveSpan(spans);
		const tip = await provider.getBlockNumber();
		const fromBlock = live
			? live.toBlock + 1n
			: clampFromBlock(tip - blockRangeLimit, floorBlock);
		return scanRange(fromBlock, tip);
	};

	const fetchHistory = async (): Promise<RawLog[]> => {
		const spans = await loadSpans();
		const earliest = earliestSpan(spans);
		const tip = await provider.getBlockNumber();
		const toBlock = earliest
			? earliest.fromBlock - 1n
			: clampFromBlock(tip - blockRangeLimit, floorBlock);
		if (toBlock <= floorBlock) return [];
		const fromBlock = clampFromBlock(
			toBlock - blockRangeLimit + 1n,
			floorBlock,
		);
		return scanRange(fromBlock, toBlock);
	};

	const fetchForward = async (): Promise<RawLog[]> => {
		if (atBlock == null) return [];

		const spans = await loadSpans();
		const live = liveSpan(spans);
		const existing = spanNear(spans, atBlock);
		if (existing && existing === live) return []; // already merged

		const tip = await provider.getBlockNumber();
		const fromBlock = existing ? existing.toBlock + 1n : atBlock;
		const cappedTo = live ? live.fromBlock - 1n : tip;
		const windowEnd = fromBlock + blockRangeLimit - 1n;
		const toBlock = min(windowEnd, cappedTo, tip);
		if (toBlock < fromBlock) return [];

		return scanRange(fromBlock, toBlock);
	};

	const getScannedSpans = () => loadSpans();

	const getCellStates = async (tip: bigint): Promise<Cell[]> =>
		cellStates(await loadSpans(), floorBlock, tip, blockRangeLimit);

	const isFullyScanned = async (): Promise<boolean> => {
		const spans = await loadSpans();
		const earliest = earliestSpan(spans);
		const live = liveSpan(spans);
		return (
			earliest != null && earliest === live && earliest.fromBlock <= floorBlock
		);
	};

	const getLiveSpan = async () => liveSpan(await loadSpans());
	const getEarliestSpan = async () => earliestSpan(await loadSpans());

	return {
		scanRange,
		sync,
		fetchHistory,
		fetchForward,
		getScannedSpans,
		getCellStates,
		isFullyScanned,
		getLiveSpan,
		getEarliestSpan,
	};
};
