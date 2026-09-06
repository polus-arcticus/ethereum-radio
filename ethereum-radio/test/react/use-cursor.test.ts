import {before, describe, it} from 'node:test';
import {expect} from 'earl';
import {renderHook} from './harness.ts';
import {useCursor, type UseCursorArgs} from '../../src/react/use-cursor.ts';
import type {Checkpoint} from '../../src/core/checkpoints.ts';
import {createMemoryStore} from '../../src/storage/memory.ts';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import {
	EMPTY_ADDRESS,
	LIMITED_RPC_URL,
	createViemTestClients,
	ensureTip,
	getTip,
} from '../fixtures/chain-environment.ts';

const RANGE = 100n;
const realProvider = (rpcUrl?: string) =>
	createViemAdapter(createViemTestClients(rpcUrl).publicClient);

// Tests below subtract up to 400 from the real tip to compute floorBlock —
// on a truly fresh chain (docker-compose just started) that goes negative.
before(() => ensureTip(500n));

describe('useCursor (real Anvil)', () => {
	it('seeds a shallow initial window on mount', async () => {
		const tip = await getTip();
		const floor = tip - 300n;
		const args: UseCursorArgs = {
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		};

		// `result` is a live getter — always read it via `harness.result`, not
		// a one-time destructure, or you'll freeze a snapshot from whatever
		// render happened to be current at destructure time.
		const harness = await renderHook(useCursor, args);
		await harness.flush();

		// sync()'s no-live-span seed is clampFromBlock(tip - blockRangeLimit,
		// floor) — no "+1" — so the window is blockRangeLimit+1 (101) wide.
		expect(harness.result.scannedSpans).toEqual([
			{fromBlock: tip - 100n, toBlock: tip},
		]);
		expect(harness.result.isLoading).toEqual(false);
		expect(harness.result.error).toEqual(undefined);
		expect(harness.result.cellStates.length > 0).toEqual(true);
	});

	it('fetchHistory extends the earliest span backward and updates state', async () => {
		const tip = await getTip();
		const floor = tip - 400n;
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: tip - 100n, toBlock: tip}]);
		const args: UseCursorArgs = {
			provider: realProvider(),
			store,
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		};

		const harness = await renderHook(useCursor, args);
		await harness.flush();
		await harness.act(() => harness.result.fetchHistory());

		expect(harness.result.scannedSpans).toEqual([
			{fromBlock: tip - 200n, toBlock: tip},
		]);
	});

	it('isFullyScanned becomes true once the mount sync reaches the floor', async () => {
		const tip = await getTip();
		// Comfortably inside sync()'s 101-wide seed window, so the hook's own
		// mount-triggered sync() alone is enough to reach the floor — no
		// pre-seeding needed (unlike the mock version, a real chain's tip
		// can't be pinned to an arbitrary past value).
		const floor = tip - 50n;
		const args: UseCursorArgs = {
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
		};

		const harness = await renderHook(useCursor, args);
		await harness.flush();

		expect(harness.result.isFullyScanned).toEqual(true);
	});

	it('surfaces real provider errors without throwing', async () => {
		const tip = await getTip();
		// blockRangeLimit (100) exceeds rpc-limiter's real cap (10), so the
		// mount sync's first eth_getLogs call gets a genuine rejection.
		const args: UseCursorArgs = {
			provider: realProvider(LIMITED_RPC_URL),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: RANGE,
		};

		const harness = await renderHook(useCursor, args);
		await harness.flush();

		expect(harness.result.error instanceof Error).toEqual(true);
		expect(harness.result.isLoading).toEqual(false);
	});

	it('checkForReorg establishes a baseline and updates state', async () => {
		const tip = await getTip();
		const provider = realProvider();
		const args: UseCursorArgs = {
			provider,
			store: createMemoryStore(),
			checkpointStore: createMemoryStore<Checkpoint>(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: RANGE,
		};

		const harness = await renderHook(useCursor, args);
		await harness.flush();
		const result = await harness.act(() => harness.result.checkForReorg(tip, tip));

		expect(result).toEqual({status: 'unchecked'});
		expect(harness.result.error).toEqual(undefined);
	});
});
