import {describe, it} from 'node:test';
import {expect} from 'earl';
import {renderHook} from './harness.ts';
import {useCursor, type UseCursorArgs} from '../../src/react/use-cursor.ts';
import {createMemoryStore} from '../../src/storage/memory.ts';
import {createMockLogsProvider} from '../fixtures/mock-logs-provider.ts';

const ADDRESS = '0x0000000000000000000000000000000000000001';
const FLOOR = 1_000n;
const RANGE = 100n;

describe('useCursor', () => {
	it('seeds a shallow initial window on mount', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_350n});
		const store = createMemoryStore();
		const args: UseCursorArgs = {
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		};

		// `result` is a live getter — always read it via `harness.result`, not
		// a one-time destructure, or you'll freeze a snapshot from whatever
		// render happened to be current at destructure time.
		const harness = await renderHook(useCursor, args);
		await harness.flush();

		expect(harness.result.scannedSpans).toEqual([
			{fromBlock: 1_250n, toBlock: 1_350n},
		]);
		expect(harness.result.isLoading).toEqual(false);
		expect(harness.result.error).toEqual(undefined);
		expect(harness.result.cellStates.length > 0).toEqual(true);
	});

	it('fetchHistory extends the earliest span backward and updates state', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_350n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: 1_250n, toBlock: 1_350n}]);
		const args: UseCursorArgs = {
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		};

		const harness = await renderHook(useCursor, args);
		await harness.flush();
		await harness.act(() => harness.result.fetchHistory());

		expect(harness.result.scannedSpans).toEqual([
			{fromBlock: 1_150n, toBlock: 1_350n},
		]);
	});

	it('isFullyScanned becomes true once the scanned span reaches the floor', async () => {
		const provider = createMockLogsProvider({logs: [], tip: 1_099n});
		const store = createMemoryStore();
		await store.save('k', [{fromBlock: FLOOR, toBlock: 1_099n}]);
		const args: UseCursorArgs = {
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		};

		const harness = await renderHook(useCursor, args);
		await harness.flush();

		expect(harness.result.isFullyScanned).toEqual(true);
	});

	it('surfaces provider errors without throwing', async () => {
		const provider = createMockLogsProvider({
			logs: [],
			tip: 1_350n,
			maxRangePerCall: 0n,
		});
		const store = createMemoryStore();
		const args: UseCursorArgs = {
			provider,
			store,
			key: 'k',
			address: ADDRESS,
			floorBlock: FLOOR,
			blockRangeLimit: RANGE,
		};

		const harness = await renderHook(useCursor, args);
		await harness.flush();

		expect(harness.result.error instanceof Error).toEqual(true);
		expect(harness.result.isLoading).toEqual(false);
	});
});
