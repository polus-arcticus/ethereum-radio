import {describe, it} from 'node:test';
import {expect} from 'earl';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import type {PublicClient} from 'viem';

const ADDRESS = '0x0000000000000000000000000000000000000001';

// A minimal fake satisfying only what createViemAdapter actually calls
// (getBlockNumber, request) — enough to verify request shaping and
// field-name/type normalization without a real network.
const fakeClient = (rawLog: Record<string, unknown>): PublicClient =>
	({
		getBlockNumber: async () => 123n,
		request: async ({method, params}: any) => {
			if (method !== 'eth_getLogs')
				throw new Error(`unexpected method ${method}`);
			(fakeClient as any).lastParams = params;
			return [rawLog];
		},
	}) as unknown as PublicClient;

const RAW_LOG = {
	address: ADDRESS,
	topics: ['0xtopic0', '0xtopic1'],
	data: '0xdata',
	blockNumber: '0xa',
	transactionHash: '0xtx',
	logIndex: '0x1',
	blockHash: '0xblockhash',
	transactionIndex: '0x0',
	removed: false,
};

describe('createViemAdapter', () => {
	it('passes getBlockNumber through', async () => {
		const adapter = createViemAdapter(fakeClient(RAW_LOG));
		expect(await adapter.getBlockNumber()).toEqual(123n);
	});

	it('encodes fromBlock/toBlock as hex and forwards address/topics in the eth_getLogs request', async () => {
		const client = fakeClient(RAW_LOG);
		const adapter = createViemAdapter(client);
		await adapter.getLogs({
			address: ADDRESS,
			topics: ['0xtopic0'],
			fromBlock: 100n,
			toBlock: 200n,
		});
		expect((fakeClient as any).lastParams).toEqual([
			{
				address: ADDRESS,
				topics: ['0xtopic0'],
				fromBlock: '0x64',
				toBlock: '0xc8',
			},
		]);
	});

	it('normalizes hex-encoded fields into RawLog (bigint blockNumber, numeric logIndex)', async () => {
		const adapter = createViemAdapter(fakeClient(RAW_LOG));
		const [log] = await adapter.getLogs({
			address: ADDRESS,
			fromBlock: 0n,
			toBlock: 10n,
		});
		expect(log).toEqual({
			address: ADDRESS,
			topics: ['0xtopic0', '0xtopic1'],
			data: '0xdata',
			blockNumber: 10n,
			transactionHash: '0xtx',
			logIndex: 1,
			blockHash: '0xblockhash',
			transactionIndex: 0,
			removed: false,
		});
	});
});
