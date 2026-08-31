import type {Provider} from 'ethers';
import type {GetLogsParams, LogsProvider, RawLog} from './types.ts';

// Wraps an already-constructed ethers Provider. Normalizes the two spots
// where ethers v6's shape differs from viem's: getBlockNumber() returns a
// plain number (wrapped in BigInt here), and a log's index field is named
// `index` rather than `logIndex`.
export const createEthersAdapter = (provider: Provider): LogsProvider => ({
	getBlockNumber: async () => BigInt(await provider.getBlockNumber()),
	getLogs: async (params: GetLogsParams): Promise<RawLog[]> => {
		const logs = await provider.getLogs({
			address: params.address as any,
			topics: params.topics as any,
			fromBlock: params.fromBlock,
			toBlock: params.toBlock,
		});
		return logs.map((l) => ({
			address: l.address,
			topics: [...l.topics],
			data: l.data,
			blockNumber: BigInt(l.blockNumber),
			transactionHash: l.transactionHash,
			logIndex: l.index,
			blockHash: l.blockHash,
			transactionIndex: l.transactionIndex,
			removed: l.removed,
		}));
	},
});
