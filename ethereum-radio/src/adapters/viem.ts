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
	getBlockHash: async (blockNumber: bigint) => {
		const block = await client.getBlock({blockNumber});
		if (!block.hash) throw new Error(`Block ${blockNumber} has no hash yet`);
		return block.hash;
	},
	getLogs: async (params: GetLogsParams): Promise<RawLog[]> => {
		// retryCount: 0 — viem's default transport silently retries a JSON-RPC
		// "Internal error" (-32603) up to 3x with exponential backoff, which is
		// exactly the error a too-large range or rpc-doctor's step-down probing
		// gets back; that failure is deterministic (the same range will fail
		// identically every time), so the retries just add latency. This
		// mirrors viem's own wallet actions (sendTransaction, switchChain, ...),
		// which pass the same override for calls where blind retry is wrong.
		// Cursor's span-based resumability already covers "try again later" for
		// a chunk that fails for a genuinely transient reason.
		const logs = await client.request(
			{
				method: 'eth_getLogs',
				params: [
					{
						address: params.address as `0x${string}` | `0x${string}`[],
						topics: params.topics as any,
						fromBlock: numberToHex(params.fromBlock),
						toBlock: numberToHex(params.toBlock),
					},
				],
			},
			{retryCount: 0},
		);
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
