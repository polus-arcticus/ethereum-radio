import {before, describe, it} from 'node:test';
import {expect} from 'earl';
import {renderHook} from './harness.ts';
import {useRadioController, type UseRadioControllerArgs} from '../../src/react/use-radio-controller.ts';
import {createMemoryStore} from '../../src/storage/memory.ts';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import {
	EMPTY_ADDRESS,
	LIMITED_RPC_URL,
	createViemTestClients,
	ensureTip,
	getTip,
	logValue,
	mineBlocks,
	readEventFixture,
	recordCalls,
} from '../fixtures/chain-environment.ts';

const RANGE = 10n;
const realProvider = (rpcUrl?: string) =>
	createViemAdapter(createViemTestClients(rpcUrl).publicClient);

// Tests below subtract a few hundred blocks from the real tip to compute
// floorBlock — on a truly fresh chain that goes negative.
before(() => ensureTip(500n));

// A short, deterministic wait for statusPollMs-driven state (isTakingAWhile,
// 'caught-up') to update — real setInterval/setTimeout ticks, not fake
// timers, so this has to be real wall-clock time. Wrapped through
// harness.act so React's act() sees whatever state updates land during it.
const waitForStatusTick = (harness: {act: <T>(cb: () => Promise<T>) => Promise<T>}, ms = 60) =>
	harness.act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe('useRadioController (real Anvil)', () => {
	it('reaches caught-up once the mount sync reaches the floor', async () => {
		const tip = await getTip();
		const floor = tip - 5n;
		const args: UseRadioControllerArgs = {
			provider: realProvider(),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
			pollIntervalMs: 5,
			statusPollMs: 20,
		};

		const harness = await renderHook(useRadioController, args);
		try {
			await harness.flush();
			await waitForStatusTick(harness);

			expect(harness.result.status).toEqual('caught-up');
			expect(harness.result.error).toEqual(undefined);
		} finally {
			// The hook always runs a setInterval for status polling (unlike
			// useCursor's, which only exists when pollIntervalMs is passed) — an
			// un-unmounted harness leaves it running forever, which never lets
			// the test process's event loop go idle.
			await harness.unmount();
		}
	});

	it('pause() stops further provider calls without losing scan progress', async () => {
		const fixture = readEventFixture();
		const floor = await mineBlocks(1n);
		await logValue(1n);
		await logValue(2n);
		await mineBlocks(50n);

		const provider = recordCalls(realProvider());
		const store = createMemoryStore();
		const args: UseRadioControllerArgs = {
			provider,
			store,
			key: 'k',
			address: fixture.address,
			floorBlock: floor,
			blockRangeLimit: RANGE,
			pollIntervalMs: 5,
			statusPollMs: 20,
		};

		const harness = await renderHook(useRadioController, args);
		try {
			await harness.flush();
			await waitForStatusTick(harness);

			await harness.act(async () => {
				harness.result.pause();
			});
			expect(harness.result.status).toEqual('paused');

			const callsAtPause = provider.calls.length;
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(provider.calls.length).toEqual(callsAtPause);

			const spansAtPause = await harness.result.cursor.getScannedSpans();
			expect(spansAtPause.length > 0).toEqual(true);

			// A quiescent chain means sync() would otherwise short-circuit before
			// ever calling the provider (fromBlock > toBlock — nothing new to
			// fetch, see Cursor.scanRange) even once resumed. Mine a block so
			// there's genuinely new tip movement for the resumed scan to catch
			// up on, the way a real pause/resume almost always has.
			await mineBlocks(1n);

			await harness.act(async () => {
				harness.result.resume();
			});
			await waitForStatusTick(harness, 100);

			expect(provider.calls.length > callsAtPause).toEqual(true);
			expect(harness.result.status).toEqual('caught-up');
		} finally {
			await harness.unmount();
		}
	});

	it('cancel() is terminal — resume() afterward is a no-op', async () => {
		const tip = await getTip();
		const floor = tip - 5n;
		const provider = recordCalls(realProvider());
		const args: UseRadioControllerArgs = {
			provider,
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: floor,
			blockRangeLimit: RANGE,
			pollIntervalMs: 5,
			statusPollMs: 20,
		};

		const harness = await renderHook(useRadioController, args);
		try {
			await harness.flush();

			await harness.act(async () => {
				harness.result.cancel();
			});
			expect(harness.result.status).toEqual('cancelled');

			const callsAtCancel = provider.calls.length;
			await harness.act(async () => {
				harness.result.resume();
			});
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(harness.result.status).toEqual('cancelled');
			expect(provider.calls.length).toEqual(callsAtCancel);
		} finally {
			await harness.unmount();
		}
	});

	it('surfaces real provider errors without throwing', async () => {
		const tip = await getTip();
		// blockRangeLimit exceeds rpc-limiter's real cap (10), so the mount
		// sync's first eth_getLogs call gets a genuine rejection.
		const args: UseRadioControllerArgs = {
			provider: realProvider(LIMITED_RPC_URL),
			store: createMemoryStore(),
			key: 'k',
			address: EMPTY_ADDRESS,
			floorBlock: tip - 300n,
			blockRangeLimit: 100n,
			pollIntervalMs: 5,
			statusPollMs: 20,
		};

		const harness = await renderHook(useRadioController, args);
		try {
			await harness.flush();

			expect(harness.result.status).toEqual('error');
			expect(harness.result.error instanceof Error).toEqual(true);
		} finally {
			await harness.unmount();
		}
	});
});
