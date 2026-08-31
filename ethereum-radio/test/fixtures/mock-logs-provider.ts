import type {
	GetLogsParams,
	LogsProvider,
	RawLog,
} from '../../src/adapters/types.ts';

export interface MockLogsProviderOptions {
	logs: RawLog[];
	tip: bigint;
	// Simulates a range-limited RPC (e.g. a public provider's free tier):
	// getLogs throws if the requested window is wider than this.
	maxRangePerCall?: bigint;
}

export interface MockLogsProvider extends LogsProvider {
	calls: GetLogsParams[];
	setTip(tip: bigint): void;
}

const logInRange = (
	log: RawLog,
	address: string | string[],
	fromBlock: bigint,
	toBlock: bigint,
): boolean => {
	const addresses = Array.isArray(address) ? address : [address];
	return (
		addresses.some((a) => a.toLowerCase() === log.address.toLowerCase()) &&
		log.blockNumber >= fromBlock &&
		log.blockNumber <= toBlock
	);
};

export const createMockLogsProvider = (
	options: MockLogsProviderOptions,
): MockLogsProvider => {
	let tip = options.tip;
	const calls: GetLogsParams[] = [];

	return {
		calls,
		setTip: (newTip: bigint) => {
			tip = newTip;
		},
		getBlockNumber: async () => tip,
		getLogs: async (params: GetLogsParams): Promise<RawLog[]> => {
			calls.push(params);
			const range = params.toBlock - params.fromBlock + 1n;
			if (options.maxRangePerCall != null && range > options.maxRangePerCall) {
				throw new Error(
					`mock RPC: requested range ${range} exceeds maxRangePerCall ${options.maxRangePerCall}`,
				);
			}
			return options.logs.filter((log) =>
				logInRange(log, params.address, params.fromBlock, params.toBlock),
			);
		},
	};
};
