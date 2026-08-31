import type {GetLogsParams, LogsProvider, RawLog} from '../adapters/types.ts';

// Floors a computed fromBlock at a given floor (typically a contract's
// deployment block) — logs can never exist before that.
export const clampFromBlock = (candidate: bigint, floor: bigint): bigint =>
	candidate > floor ? candidate : floor;

// Fetches logs across [fromBlock, toBlock] in blockRangeLimit-sized windows,
// via a stateless provider.getLogs(...) call per window. Unlike a
// filter-handle-based approach (eth_newFilter + eth_getFilterLogs), a
// stateless getLogs call per window can't have its server-side filter state
// dropped by a round-robin/load-balanced RPC backend between two calls —
// this is also what makes the same chunking logic work identically against
// both a viem and an ethers adapter, since both expose getLogs directly.
export const chunkedFetchLogs = async (
	provider: LogsProvider,
	params: GetLogsParams,
	blockRangeLimit: bigint,
): Promise<RawLog[]> => {
	if (blockRangeLimit <= 0n) {
		throw new Error('chunkedFetchLogs: blockRangeLimit must be greater than 0');
	}

	const {address, topics, fromBlock, toBlock} = params;
	const logs: RawLog[] = [];

	for (let from = fromBlock; from <= toBlock; from += blockRangeLimit) {
		const windowEnd = from + blockRangeLimit - 1n;
		const to = windowEnd > toBlock ? toBlock : windowEnd;
		const chunkLogs = await provider.getLogs({
			address,
			topics,
			fromBlock: from,
			toBlock: to,
		});
		logs.push(...chunkLogs);
	}

	return logs;
};

// A single unbounded call across the whole range — no chunking. Useful when
// the caller already knows the RPC can handle the full range (e.g. a local
// node), or as the fallback before a blockRangeLimit has been established.
export const fetchAllLogs = async (
	provider: LogsProvider,
	params: GetLogsParams,
): Promise<RawLog[]> => provider.getLogs(params);
