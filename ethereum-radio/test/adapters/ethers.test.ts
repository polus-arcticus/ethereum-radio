import {describe, it} from 'node:test';
import {expect} from 'earl';
import {createEthersAdapter} from '../../src/adapters/ethers.ts';
import type {Provider} from 'ethers';

const ADDRESS = '0x0000000000000000000000000000000000000001';

// A minimal fake satisfying only what createEthersAdapter actually calls
// (getBlockNumber, getLogs) — enough to verify field-name/type
// normalization (ethers' plain-number block, `index` vs `logIndex`) without
// a real network.
const fakeProvider = (): Provider =>
	({
		getBlockNumber: async () => 123,
		getLogs: async (filter: any) => {
			(fakeProvider as any).lastFilter = filter;
			return [
				{
					address: ADDRESS,
					topics: ['0xtopic0', '0xtopic1'],
					data: '0xdata',
					blockNumber: 10,
					transactionHash: '0xtx',
					index: 1,
					blockHash: '0xblockhash',
					transactionIndex: 0,
					removed: false,
				},
			];
		},
	}) as unknown as Provider;

describe('createEthersAdapter', () => {
	it('wraps a plain-number getBlockNumber() as bigint', async () => {
		const adapter = createEthersAdapter(fakeProvider());
		expect(await adapter.getBlockNumber()).toEqual(123n);
	});

	it('forwards address/topics/fromBlock/toBlock to provider.getLogs', async () => {
		const provider = fakeProvider();
		const adapter = createEthersAdapter(provider);
		await adapter.getLogs({
			address: ADDRESS,
			topics: ['0xtopic0'],
			fromBlock: 100n,
			toBlock: 200n,
		});
		expect((fakeProvider as any).lastFilter).toEqual({
			address: ADDRESS,
			topics: ['0xtopic0'],
			fromBlock: 100n,
			toBlock: 200n,
		});
	});

	it("normalizes ethers' Log shape into RawLog (bigint blockNumber, index -> logIndex)", async () => {
		const adapter = createEthersAdapter(fakeProvider());
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
