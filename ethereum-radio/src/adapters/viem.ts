import {formatLog, numberToHex, type PublicClient} from 'viem';
import type {GetLogsParams, LogsProvider, RawLog} from './types.ts';

// Wraps an already-constructed viem PublicClient — this module never
// constructs its own client, so a consumer stays in full control of chain/
// transport configuration.
//
// viem's typed `getLogs` action only supports ABI event-based filtering
// (event/events/args), not arbitrary raw topics — decoding is out of scope
// for this package (see adapters/types.ts), so this calls the raw
// `eth_getLogs` JSON-RPC method directly and formats the result with viem's
// own `formatLog`, mirroring what `getLogs`'s own implementation does
// internally before it hands off to ABI decoding.
export const createViemAdapter = (client: PublicClient): LogsProvider => ({
	getBlockNumber: () => client.getBlockNumber(),
	getLogs: async (params: GetLogsParams): Promise<RawLog[]> => {
		const logs = await client.request({
			method: 'eth_getLogs',
			params: [
				{
					address: params.address as `0x${string}` | `0x${string}`[],
					topics: params.topics as any,
					fromBlock: numberToHex(params.fromBlock),
					toBlock: numberToHex(params.toBlock),
				},
			],
		});
		return logs.map((log: any) => {
			const formatted = formatLog(log);
			return {
				address: formatted.address,
				topics: formatted.topics as string[],
				data: formatted.data,
				blockNumber: formatted.blockNumber!,
				transactionHash: formatted.transactionHash!,
				logIndex: formatted.logIndex!,
				blockHash: formatted.blockHash!,
				transactionIndex: formatted.transactionIndex!,
				removed: formatted.removed,
			};
		});
	},
});
