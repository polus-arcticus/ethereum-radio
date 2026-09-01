import {before, describe, it} from 'node:test';
import {expect} from 'earl';
import {numberToHex} from 'viem';
import {radio, createRadio} from '../../src/core/radio.ts';
import {createCursor} from '../../src/core/cursor.ts';
import {createMemoryStore} from '../../src/storage/memory.ts';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import {
	EMPTY_ADDRESS,
	createViemTestClients,
	ensureTip,
	getTip,
	mineBlocks,
	readEventFixture,
	recordCalls,
	logValue,
} from '../fixtures/chain-environment.ts';
import type {RawLog} from '../../src/adapters/types.ts';

const RANGE = 100n;
const realProvider = () =>
	createViemAdapter(createViemTestClients().publicClient);

// "break-ing..." below subtracts 300 from a real receipt's block number to
// compute floorBlock — on a truly fresh chain that goes negative.
before(() => ensureTip(500n));

// Lands a real logValue transaction at exactly block `target` (must be
// >= the current real tip + 1) by mining empty blocks up to target - 1 first
// (anvil_mine, near-instant) and then submitting the tx as the next block.
const logValueAt = async (target: bigint, value: bigint) => {
	const tip = await getTip();
	if (target > tip + 1n) await mineBlocks(target - 1n - tip);
	const receipt = await logValue(value);
	if (receipt.blockNumber !== target) {
		throw new Error(
			`logValueAt: landed at ${receipt.blockNumber}, expected ${target}`,
		);
	}
	return receipt;
};

describe('radio (real Anvil)', () => {
	it('drains history chunks (newest-window-first) before ever polling live', async () => {
		const fixture = readEventFixture();
		// floorBlock is an inclusive lower bound for the final fetchHistory
		// window below, so it must land on a block guaranteed to have no
		// pre-existing log from an earlier test file — mine one fresh empty
		// block rather than trusting whatever the current tip happens to be.
		const floor = await mineBlocks(1n);

		// sync()'s seed window is [floor+250, floor+350] (width
		// blockRangeLimit+1); fetchHistory() then walks backward one
		// blockRangeLimit window at a time: [floor+150,floor+249],
		// [floor+50,floor+149], [floor,floor+49] (clamped at floor) — one real
		// log placed in each so every chunk is non-empty and the yield order
		// is unambiguous. See test/core/cursor.test.ts for the same
		// tip/floor-relative window arithmetic, verified there independently.
		await logValueAt(floor + 20n, 1n);
		await logValueAt(floor + 100n, 2n);
		await logValueAt(floor + 200n, 3n);
		await logValueAt(floor + 300n, 4n);
		await mineBlocks(floor + 350n - (await getTip()));

		const cursor = createCursor({
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: fixture.address,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});

		const received: bigint[][] = [];
		for await (const chunk of radio(cursor, {pollIntervalMs: 5})) {
			received.push(chunk.map((l) => l.blockNumber));
			if (received.length === 4) break;
		}

		expect(received).toEqual([
			[floor + 300n],
			[floor + 200n],
			[floor + 100n],
			[floor + 20n],
		]);
		expect(await cursor.isFullyScanned()).toEqual(true);
	});

	it('yields live-tail chunks once history is fully scanned', async () => {
		const fixture = readEventFixture();
		const floor = await getTip();
		const store = createMemoryStore();
		// Trivially fully-scanned: the one span already spans floor..floor
		// (the current tip), so earliest === live and fromBlock <= floor.
		await store.save('k', [{fromBlock: floor, toBlock: floor}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: fixture.address,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});

		const it_ = radio(cursor, {pollIntervalMs: 5})[Symbol.asyncIterator]();
		const nextPromise = it_.next();

		// Let a few empty poll cycles pass before a new real block/log arrives.
		await new Promise((resolve) => setTimeout(resolve, 20));
		const receipt = await logValue(999_500n);

		const {value, done} = await nextPromise;
		expect(done).toEqual(false);
		expect(value?.map((l) => l.blockNumber)).toEqual([receipt.blockNumber]);

		await it_.return(undefined);
	});

	it('break-ing the for-await loop stops further provider calls', async () => {
		const fixture = readEventFixture();
		const receipt = await logValue(999_501n);
		const store = createMemoryStore();
		const provider = recordCalls(realProvider());
		const cursor = createCursor({
			provider,
			store,
			key: 'k',
			address: fixture.address,
			// A 300-block lookback window can reach into leftover ValueLogged
			// events from earlier tests at this same shared contract address —
			// filter to this test's own exact value-topic so only its own log
			// can ever match.
			topics: [null, null, numberToHex(999_501n, {size: 32})],
			floorBlock: receipt.blockNumber - 300n,
			blockRangeLimit: RANGE,
		});

		for await (const chunk of radio(cursor, {pollIntervalMs: 5})) {
			expect(chunk.map((l) => l.blockNumber)).toEqual([receipt.blockNumber]);
			break; // first chunk is from the initial sync()
		}
		const callsAfterBreak = provider.calls.length;

		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(provider.calls.length).toEqual(callsAfterBreak);
	});

	it('stops the live-tail loop once the AbortSignal is aborted', async () => {
		const floor = await getTip();
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: floor, toBlock: floor}]);
		const cursor = createCursor({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});
		const controller = new AbortController();

		const results: RawLog[][] = [];
		const iteration = (async () => {
			for await (const chunk of radio(cursor, {
				pollIntervalMs: 5,
				signal: controller.signal,
			})) {
				results.push(chunk);
			}
		})();

		await new Promise((resolve) => setTimeout(resolve, 20));
		controller.abort();
		await iteration; // resolves once the generator observes the abort and returns

		expect(results).toEqual([]);
	});
});

describe('createRadio (real Anvil)', () => {
	it('streams via for-await directly, no separate radio(cursor) call needed', async () => {
		const fixture = readEventFixture();
		const receipt = await logValue(999_600n);
		const store = createMemoryStore();
		const radioInstance = createRadio(
			{
				provider: recordCalls(realProvider()),
				store,
				key: 'k',
				address: fixture.address,
				topics: [null, null, numberToHex(999_600n, {size: 32})],
				floorBlock: receipt.blockNumber - 300n,
				blockRangeLimit: RANGE,
			},
			{pollIntervalMs: 5},
		);

		const received: bigint[][] = [];
		for await (const chunk of radioInstance) {
			received.push(chunk.map((l) => l.blockNumber));
			break; // first chunk is from the initial sync()
		}

		expect(received).toEqual([[receipt.blockNumber]]);
	});

	it('exposes Cursor methods on the same object, independent of iteration', async () => {
		const floor = await getTip();
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: floor, toBlock: floor}]);
		const radioInstance = createRadio({
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		});

		// Cursor methods work without ever touching the async-iterator side.
		expect(await radioInstance.isFullyScanned()).toEqual(true);
		expect(await radioInstance.getScannedSpans()).toEqual([
			{fromBlock: floor, toBlock: floor},
		]);
	});
});
