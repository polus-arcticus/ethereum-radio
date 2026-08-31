import {describe, it} from 'node:test';
import {expect} from 'earl';
import {createCursor} from '../../src/core/cursor.ts';
import {createMemoryStore} from '../../src/storage/memory.ts';
import {createMockLogsProvider} from '../fixtures/mock-logs-provider.ts';
import type {RawLog} from '../../src/adapters/types.ts';

const ADDRESS = '0x0000000000000000000000000000000000000001';
const FLOOR = 1_000n;
const RANGE = 100n;

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

describe('createCursor: sync', () => {
	it('seeds a shallow initial window when nothing has been scanned yet', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_350n});
		const store = createMemoryStore();
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});

		await cursor.sync();

		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: 1_250n, toBlock: 1_350n},
		]);
	});

	it('extends from the live span end to the tip on a subsequent call', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_350n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: 1_250n, toBlock: 1_350n}]);
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});

		provider.setTip(1_400n);
		await cursor.sync();

		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: 1_250n, toBlock: 1_400n},
		]);
	});
});

describe('createCursor: fetchHistory', () => {
	it('extends the earliest span one blockRangeLimit window further back', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: 1_300n, toBlock: 1_400n}]);
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});

		await cursor.fetchHistory();

		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: 1_200n, toBlock: 1_400n},
		]);
	});

	it('clamps the backward window at floorBlock and stops once the floor is reached', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: 1_050n, toBlock: 1_400n}]);
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});

		await cursor.fetchHistory();
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: FLOOR, toBlock: 1_400n},
		]);

		// A further call has nothing left to backfill (toBlock would be <= floorBlock) and is a no-op.
		const result = await cursor.fetchHistory();
		expect(result).toEqual([]);
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: FLOOR, toBlock: 1_400n},
		]);
	});
});

describe('createCursor: fetchForward', () => {
	it('is a no-op when no atBlock anchor is configured', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});

		expect(await cursor.fetchForward()).toEqual([]);
	});

	it('extends the atBlock-anchored span forward, capped by blockRangeLimit and the live span start', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: 1_400n, toBlock: 1_500n}]); // the live/tip-tailed span
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
			atBlock: 1_100n,
		});

		await cursor.fetchForward();

		// window from 1100 would reach 1199 (blockRangeLimit=100), well short of the live span's 1400 start.
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: 1_100n, toBlock: 1_199n},
			{fromBlock: 1_400n, toBlock: 1_500n},
		]);
	});

	it('stops (no-op) once the anchored span has merged into the live span', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: 1_100n, toBlock: 1_500n}]);
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
			atBlock: 1_100n,
		});

		const result = await cursor.fetchForward();
		expect(result).toEqual([]);
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: 1_100n, toBlock: 1_500n},
		]);
	});
});

describe('createCursor: isFullyScanned / getLiveSpan / getEarliestSpan', () => {
	it('is false when nothing has been scanned', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});
		expect(await cursor.isFullyScanned()).toEqual(false);
	});

	it('is false when an island span touches the floor but has not merged with the live span', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		await store.save('k', [
			{fromBlock: FLOOR, toBlock: 1_050n},
			{fromBlock: 1_400n, toBlock: 1_500n},
		]);
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});
		expect(await cursor.isFullyScanned()).toEqual(false);
	});

	it('is true once exactly one span spans floor to tip', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: FLOOR, toBlock: 1_500n}]);
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});
		expect(await cursor.isFullyScanned()).toEqual(true);
		expect(await cursor.getLiveSpan()).toEqual({
			fromBlock: FLOOR,
			toBlock: 1_500n,
		});
		expect(await cursor.getEarliestSpan()).toEqual({
			fromBlock: FLOOR,
			toBlock: 1_500n,
		});
	});
});

describe('createCursor: scanRange and getCellStates', () => {
	it('scanRange fetches, merges, and persists an arbitrary window', async () => {
		const logs = [makeLog(1_210n)];
		const provider = createMockLogsProvider({logs, tip: 1_500n});
		const store = createMemoryStore();
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});

		const result = await cursor.scanRange(1_200n, 1_299n);
		expect(result.map((l) => l.blockNumber)).toEqual([1_210n]);
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: 1_200n, toBlock: 1_299n},
		]);
	});

	it('scanRange is a no-op when toBlock < fromBlock', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});

		expect(await cursor.scanRange(1_300n, 1_200n)).toEqual([]);
		expect(await cursor.getScannedSpans()).toEqual([]);
	});

	it('getCellStates reflects the scanned spans against a given tip', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_500n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: FLOOR, toBlock: 1_099n}]);
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		});

		const cells = await cursor.getCellStates(1_299n);
		expect(cells).toEqual([
			{fromBlock: 1_000n, toBlock: 1_099n, scanned: true},
			{fromBlock: 1_100n, toBlock: 1_199n, scanned: false},
			{fromBlock: 1_200n, toBlock: 1_299n, scanned: false},
		]);
	});
});
