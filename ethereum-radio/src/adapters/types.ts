// The wire-level shape of a log as returned by eth_getLogs, independent of
// any specific contract ABI. Decoding topics/data into typed event args is
// the consumer's job (they already have viem's decodeEventLog or ethers'
// Interface.parseLog available) — this package's job ends at tracking which
// block ranges have been scanned for logs matching a filter.
export interface RawLog {
	address: string;
	topics: string[];
	data: string;
	blockNumber: bigint;
	transactionHash: string;
	logIndex: number;
	blockHash: string;
	transactionIndex: number;
	removed?: boolean;
}

export interface GetLogsParams {
	address: string | string[];
	topics?: (string | string[] | null)[];
	fromBlock: bigint;
	toBlock: bigint;
}

// The minimal client-agnostic surface this package needs. Both viem's
// PublicClient and ethers' Provider expose a native, stateless getLogs(filter)
// and getBlockNumber() — wrapping either one in this interface (see
// src/adapters/viem.ts and src/adapters/ethers.ts) is all it takes to make
// the rest of the package (chunked-logs, rpc-doctor, cursor) work with both.
export interface LogsProvider {
	getBlockNumber(): Promise<bigint>;
	getLogs(params: GetLogsParams): Promise<RawLog[]>;
	/** Optional: a block's hash by number, for Cursor.checkForReorg(). Both shipped adapters implement it. */
	getBlockHash?(blockNumber: bigint): Promise<string>;
}
