import {describe, it} from 'node:test';
import {expect} from 'earl';
import {
	clampFromBlock,
	chunkedFetchLogs,
	fetchAllLogs,
} from '../../src/core/chunked-logs.ts';
import {createMockLogsProvider} from '../fixtures/mock-logs-provider.ts';
import type {RawLog} from '../../src/adapters/types.ts';

const ADDRESS = '0x0000000000000000000000000000000000000001';

const makeLog = (blockNumber: bigint): RawLog => ({
	address: ADDRESS,
	topics: ['0xtopic'],
	data: '0x',
	blockNumber,
	transactionHash: `0xtx${blockNumber}`,
	logIndex: 0,
	blockHash: `0xblock${blockNumber}`,
	transactionIndex: 0,
});

describe('clampFromBlock', () => {
	it('returns the candidate when it is above the floor', () => {
		expect(clampFromBlock(200n, 100n)).toEqual(200n);
	});

	it('floors the candidate when it is below the floor', () => {
		expect(clampFromBlock(50n, 100n)).toEqual(100n);
	});
});

describe('chunkedFetchLogs', () => {
	it('throws when blockRangeLimit is not positive', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 100n});
		await expect(
			chunkedFetchLogs(
				provider,
				{address: ADDRESS, fromBlock: 0n, toBlock: 10n},
				0n,
			),
		).toBeRejectedWith(/blockRangeLimit must be greater than 0/);
	});

	it('splits the range into blockRangeLimit-sized windows', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 100n});
		await chunkedFetchLogs(
			provider,
			{address: ADDRESS, fromBlock: 100n, toBlock: 124n},
			10n,
		);
		expect(provider.calls.map((c) => [c.fromBlock, c.toBlock])).toEqual([
			[100n, 109n],
			[110n, 119n],
			[120n, 124n],
		]);
	});

	it('finds logs across a range wider than a single RPC call could handle', async () => {
		const logs = [makeLog(101n), makeLog(150n), makeLog(199n)];
		const provider = createMockLogsProvider({
			logs,
			tip: 200n,
			maxRangePerCall: 20n,
		});
		const result = await chunkedFetchLogs(
			provider,
			{address: ADDRESS, fromBlock: 100n, toBlock: 199n},
			20n,
		);
		expect(result.map((l) => l.blockNumber)).toEqual([101n, 150n, 199n]);
	});

	it('rejects if a single unchunked call would exceed the RPC range limit', async () => {
		const provider = createMockLogsProvider({
			logs: [],
			tip: 200n,
			maxRangePerCall: 20n,
		});
		await expect(
			fetchAllLogs(provider, {
				address: ADDRESS,
				fromBlock: 100n,
				toBlock: 199n,
			}),
		).toBeRejected();
	});
});

describe('fetchAllLogs', () => {
	it('makes a single unbounded call', async () => {
		const logs = [makeLog(101n), makeLog(150n)];
		const provider = createMockLogsProvider({logs, tip: 200n});
		const result = await fetchAllLogs(provider, {
			address: ADDRESS,
			fromBlock: 100n,
			toBlock: 199n,
		});
		expect(result.map((l) => l.blockNumber)).toEqual([101n, 150n]);
		expect(provider.calls.length).toEqual(1);
	});
});
