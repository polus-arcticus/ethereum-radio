import {before, describe, it} from 'node:test';
import {expect} from 'earl';
import {createCursor} from '../../src/core/cursor.ts';
import type {Checkpoint} from '../../src/core/checkpoints.ts';
import {createMemoryStore} from '../../src/storage/memory.ts';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import {
	EMPTY_ADDRESS,
	createViemTestClients,
	ensureTip,
	getTip,
	mineBlocks,
	readEventFixture,
	logValue,
	simulateReorgAtNextBlock,
} from '../fixtures/chain-environment.ts';

const RANGE = 100n;

// Cursor's span math doesn't depend on real log content for most of these
// cases (mirroring the original mock-based tests, which mostly used
// `logs: []`) — only that getBlockNumber()/getLogs() are real round trips
// against the real chain. EMPTY_ADDRESS has no code and no logs ever
// emitted against it, so it's real getLogs calls that always legitimately
// return []. Every test reads the real current tip fresh and computes
// floorBlock/atBlock as offsets from it, rather than a hardcoded literal —
// that's what keeps tests independent on one shared, never-reset chain.
const realProvider = () =>
	createViemAdapter(createViemTestClients().publicClient);

// Tests below subtract up to 400 from the real tip to compute floorBlock —
// on a truly fresh chain (docker-compose just started) that goes negative.
// Mine ahead once so every test in this file has room, regardless of order.
before(() => ensureTip(500n));

describe('createCursor: sync', () => {
	it('seeds a shallow initial window when nothing has been scanned yet', async () => {
		const tip = await getTip();
		const floor = tip - 300n;
		const cursor = createCursor({
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});

		await cursor.sync();

		// sync()'s no-live-span seed uses clampFromBlock(tip - blockRangeLimit,
		// floor) — no "+1" — so the window is blockRangeLimit+1 (101) wide,
		// unlike fetchHistory's exactly-blockRangeLimit-wide windows below.
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: tip - 100n, toBlock: tip},
		]);
	});

	it('extends from the live span end to the tip on a subsequent call', async () => {
		const tip = await getTip();
		const floor = tip - 300n;
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: tip - 100n, toBlock: tip}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});

		const newTip = await mineBlocks(50n);
		await cursor.sync();

		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: tip - 100n, toBlock: newTip},
		]);
	});
});

describe('createCursor: fetchHistory', () => {
	it('extends the earliest span one blockRangeLimit window further back', async () => {
		const tip = await getTip();
		const floor = tip - 400n;
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: tip - 199n, toBlock: tip - 99n}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});

		await cursor.fetchHistory();

		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: tip - 299n, toBlock: tip - 99n},
		]);
	});

	it('clamps the backward window at floorBlock and stops once the floor is reached', async () => {
		const tip = await getTip();
		const floor = tip - 250n;
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: floor + 50n, toBlock: tip - 99n}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});

		await cursor.fetchHistory();
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: floor, toBlock: tip - 99n},
		]);

		// A further call has nothing left to backfill (toBlock would be <= floorBlock) and is a no-op.
		const result = await cursor.fetchHistory();
		expect(result).toEqual([]);
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: floor, toBlock: tip - 99n},
		]);
	});
});

describe('createCursor: fetchForward', () => {
	it('is a no-op when no atBlock anchor is configured', async () => {
		const tip = await getTip();
		const cursor = createCursor({
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: RANGE,
		});

		expect(await cursor.fetchForward()).toEqual([]);
	});

	it('extends the atBlock-anchored span forward, capped by blockRangeLimit and the live span start', async () => {
		const tip = await getTip();
		const floor = tip - 400n;
		const atBlock = floor + 100n;
		const store = createMemoryStore();
		// the live/tip-tailed span
		await store.save('k', [{fromBlock: tip - 99n, toBlock: tip}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
			atBlock,
		});

		await cursor.fetchForward();

		// window from atBlock would reach atBlock+99 (blockRangeLimit=100), well
		// short of the live span's start.
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: atBlock, toBlock: atBlock + 99n},
			{fromBlock: tip - 99n, toBlock: tip},
		]);
	});

	it('stops (no-op) once the anchored span has merged into the live span', async () => {
		const tip = await getTip();
		const floor = tip - 400n;
		const atBlock = floor + 100n;
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: atBlock, toBlock: tip}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
			atBlock,
		});

		const result = await cursor.fetchForward();
		expect(result).toEqual([]);
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: atBlock, toBlock: tip},
		]);
	});
});

describe('createCursor: isFullyScanned / getLiveSpan / getEarliestSpan', () => {
	it('is false when nothing has been scanned', async () => {
		const tip = await getTip();
		const cursor = createCursor({
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: RANGE,
		});
		expect(await cursor.isFullyScanned()).toEqual(false);
	});

	it('is false when an island span touches the floor but has not merged with the live span', async () => {
		const tip = await getTip();
		const floor = tip - 400n;
		const store = createMemoryStore();
		await store.save('k', [
			{fromBlock: floor, toBlock: floor + 50n},
			{fromBlock: tip - 99n, toBlock: tip},
		]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});
		expect(await cursor.isFullyScanned()).toEqual(false);
	});

	it('is true once exactly one span spans floor to tip', async () => {
		const tip = await getTip();
		const floor = tip - 400n;
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: floor, toBlock: tip}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});
		expect(await cursor.isFullyScanned()).toEqual(true);
		expect(await cursor.getLiveSpan()).toEqual({
			fromBlock: floor,
			toBlock: tip,
		});
		expect(await cursor.getEarliestSpan()).toEqual({
			fromBlock: floor,
			toBlock: tip,
		});
	});
});

describe('createCursor: scanRange and getCellStates', () => {
	it('scanRange fetches, merges, and persists an arbitrary window around a real log', async () => {
		const fixture = readEventFixture();
		const receipt = await logValue(800_001n);
		const cursor = createCursor({
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: fixture.address,
			floorBlock: receipt.blockNumber - 50n,
			blockRangeLimit: RANGE,
		});

		const result = await cursor.scanRange(
			receipt.blockNumber,
			receipt.blockNumber,
		);
		expect(result.map((l) => l.blockNumber)).toEqual([receipt.blockNumber]);
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber},
		]);
	});

	it('scanRange is a no-op when toBlock < fromBlock', async () => {
		const tip = await getTip();
		const cursor = createCursor({
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: RANGE,
		});

		expect(await cursor.scanRange(tip, tip - 100n)).toEqual([]);
		expect(await cursor.getScannedSpans()).toEqual([]);
	});

	it('getCellStates reflects the scanned spans against a given tip', async () => {
		const tip = await getTip();
		const floor = tip - 300n;
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: floor, toBlock: floor + 99n}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});

		const cells = await cursor.getCellStates(floor + 299n);
		expect(cells).toEqual([
			{fromBlock: floor, toBlock: floor + 99n, scanned: true},
			{fromBlock: floor + 100n, toBlock: floor + 199n, scanned: false},
			{fromBlock: floor + 200n, toBlock: floor + 299n, scanned: false},
		]);
	});
});

describe('createCursor: checkForReorg', () => {
	it('establishes a baseline checkpoint when none exists yet, and reports unchecked', async () => {
		const tip = await getTip();
		const provider = realProvider();
		const checkpointStore = createMemoryStore<Checkpoint>();
		const cursor = createCursor({
			provider,
			store: createMemoryStore(),
			checkpointStore,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: RANGE,
		});

		expect(await cursor.checkForReorg(tip, tip)).toEqual({status: 'unchecked'});

		const expectedHash = await provider.getBlockHash!(tip);
		expect(await checkpointStore.load('k')).toEqual([
			{blockNumber: tip, hash: expectedHash},
		]);
	});

	it('reports ok when the recorded hash still matches the chain', async () => {
		const tip = await getTip();
		const provider = realProvider();
		const hash = await provider.getBlockHash!(tip);
		const checkpointStore = createMemoryStore<Checkpoint>();
		await checkpointStore.save('k', [{blockNumber: tip, hash}]);
		const cursor = createCursor({
			provider,
			store: createMemoryStore(),
			checkpointStore,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: RANGE,
		});

		expect(await cursor.checkForReorg(tip, tip)).toEqual({status: 'ok'});
	});

	it('detects a mismatch, reindexes the chunk, and refreshes the checkpoint', async () => {
		const {blockNumber, originalHash, canonicalHash} =
			await simulateReorgAtNextBlock();
		const provider = realProvider();
		const checkpointStore = createMemoryStore<Checkpoint>();
		await checkpointStore.save('k', [{blockNumber, hash: originalHash}]);
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: blockNumber, toBlock: blockNumber}]);
		const cursor = createCursor({
			provider,
			store,
			checkpointStore,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: blockNumber - 10n,
			blockRangeLimit: RANGE,
		});

		const result = await cursor.checkForReorg(blockNumber, blockNumber);
		expect(result.status).toEqual('reorged');

		expect(await checkpointStore.load('k')).toEqual([
			{blockNumber, hash: canonicalHash},
		]);
		expect(await cursor.getScannedSpans()).toEqual([
			{fromBlock: blockNumber, toBlock: blockNumber},
		]);
	});

	it('throws when no checkpointStore is configured', async () => {
		const tip = await getTip();
		const cursor = createCursor({
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: RANGE,
		});

		await expect(cursor.checkForReorg(tip, tip)).toBeRejectedWith(
			/checkpointStore/,
		);
	});
});
