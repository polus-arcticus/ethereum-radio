import type {GetLogsParams, LogsProvider, RawLog} from '../adapters/types.ts';
import type {SpanStore, Store} from '../storage/types.ts';
import {
	cellStates,
	earliestSpan,
	liveSpan,
	mergeSpan,
	spanNear,
	subtractSpan,
	type Cell,
	type Span,
} from './spans.ts';
import {
	findCheckpoint,
	recordCheckpoint,
	removeCheckpointsFrom,
	type Checkpoint,
} from './checkpoints.ts';
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
	/**
	 * Optional multiplier (0–1] shrinking the actual scan window below
	 * `blockRangeLimit` — a second, independent knob from
	 * `safeBlockRangeLimit`'s one-block fencepost adjustment. Some RPCs cap
	 * `eth_getLogs` by response size/log count rather than block width, so a
	 * request that's in-range can still fail against a denser event than
	 * whatever `detectRpcCapabilities` happened to probe with. If you expect
	 * heavy log volume (e.g. every block full of USDC `Transfer` events),
	 * set this to something like `0.5` to leave headroom against that.
	 * Default: 1.0 (no padding).
	 */
	safetyPadding?: number;
	/** Optional forward-scan anchor — enables fetchForward()/sync() extending from a known block. */
	atBlock?: bigint;
	/** Required for checkForReorg() — where recorded header hashes persist. Independent of `store`; a plain Store<Checkpoint[]> (e.g. createMemoryStore<Checkpoint[]>()). */
	checkpointStore?: Store<Checkpoint[]>;
}

// The result of Cursor.checkForReorg(): 'unchecked' means no baseline hash
// was recorded yet for that chunk's top block (one is established now, for a
// future check to compare against — nothing to report yet); 'ok' means the
// hash still matches; 'reorged' means it didn't, and the chunk has already
// been reindexed by the time this resolves.
export type ReorgCheckResult =
	| {status: 'unchecked'}
	| {status: 'ok'}
	| {status: 'reorged'; logs: RawLog[]};

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
	/**
	 * Compares the chunk's top block's current hash against a previously
	 * recorded one (parentHash-chaining means that single comparison covers
	 * everything at or below `toBlock`), and reindexes the chunk on a
	 * mismatch. Requires `checkpointStore` in CursorConfig and a provider
	 * implementing `getBlockHash`. Only reindexes the checked chunk itself —
	 * if the reorg's fork point is inside it, a chunk above it may also need
	 * checking; this doesn't cascade automatically.
	 */
	checkForReorg(fromBlock: bigint, toBlock: bigint): Promise<ReorgCheckResult>;
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
		blockRangeLimit: configuredBlockRangeLimit,
		safetyPadding,
		atBlock,
		checkpointStore,
	} = config;

	// Applied once, up front — every window-sizing call below (chunkedFetchLogs,
	// span math, cellStates) reads this closed-over value rather than the raw
	// config, so a caller anticipating dense logs only has to set one option.
	const blockRangeLimit =
		safetyPadding !== undefined
			? BigInt(Math.max(1, Math.floor(Number(configuredBlockRangeLimit) * safetyPadding)))
			: configuredBlockRangeLimit;

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

	const checkForReorg = async (
		fromBlock: bigint,
		toBlock: bigint,
	): Promise<ReorgCheckResult> => {
		if (!provider.getBlockHash) {
			throw new Error(
				'checkForReorg requires a LogsProvider that implements getBlockHash',
			);
		}
		if (!checkpointStore) {
			throw new Error(
				'checkForReorg requires a checkpointStore in CursorConfig',
			);
		}

		const checkpoints = (await checkpointStore.load(key)) ?? [];
		const recorded = findCheckpoint(checkpoints, toBlock);
		const currentHash = await provider.getBlockHash(toBlock);

		if (!recorded) {
			// No baseline yet (e.g. this chunk was scanned before reorg-checking
			// was wired up) — establish one now for a future check to compare.
			await checkpointStore.save(
				key,
				recordCheckpoint(checkpoints, {blockNumber: toBlock, hash: currentHash}),
			);
			return {status: 'unchecked'};
		}

		if (recorded.hash === currentHash) return {status: 'ok'};

		// Reorged: invalidate and reindex this chunk. A chunk above it may also
		// need its own check if the fork point reaches that far — this doesn't
		// cascade automatically.
		const spans = await loadSpans();
		await store.save(key, subtractSpan(spans, {fromBlock, toBlock}));
		await checkpointStore.save(key, removeCheckpointsFrom(checkpoints, fromBlock));
		const logs = await scanRange(fromBlock, toBlock);
		const refreshed = (await checkpointStore.load(key)) ?? [];
		await checkpointStore.save(
			key,
			recordCheckpoint(refreshed, {blockNumber: toBlock, hash: currentHash}),
		);
		return {status: 'reorged', logs};
	};

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
		checkForReorg,
	};
};
