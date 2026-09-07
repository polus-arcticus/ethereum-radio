import {describe, it} from 'node:test';
import {expect} from 'earl';
import {createPublicClient, encodeEventTopics, http, parseAbiItem} from 'viem';
import {mainnet} from 'viem/chains';
import {radio} from '../../src/core/radio.ts';
import {createCursor} from '../../src/core/cursor.ts';
import {detectRpcCapabilities, safeBlockRangeLimit} from '../../src/core/rpc-doctor.ts';
import {createMemoryStore} from '../../src/storage/memory.ts';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import {recordCalls} from '../fixtures/chain-environment.ts';
import type {LogsProvider} from '../../src/adapters/types.ts';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const TRANSFER_EVENT = parseAbiItem(
	'event Transfer(address indexed from, address indexed to, uint256 value)',
);
const TRANSFER_TOPICS = encodeEventTopics({abi: [TRANSFER_EVENT], eventName: 'Transfer'});

const RPC_URL = process.env.ETH_NODE_URI_mainnet;

// A real RPC endpoint's actual cap is unknown ahead of time (a free-tier
// Alchemy/Infura key, for instance, can cap eth_getLogs as low as 10 blocks)
// — probe for it rather than guessing a literal, the same way step 2 of
// Usage recommends for any real deployment. This also means these tests
// exercise detectRpcCapabilities against a genuine restrictive RPC for the
// first time in the suite, not just the synthetic rpc-limiter fixture.
const resolveBlockRangeLimit = async (provider: LogsProvider, tip: bigint): Promise<bigint> => {
	const {maxBlockRange} = await detectRpcCapabilities(provider, WETH, tip);
	return maxBlockRange ? safeBlockRangeLimit(maxBlockRange) : 5n;
};

// Opt-in: needs a real mainnet RPC endpoint and real network access, so this
// file is excluded from the default anvil-backed `test`/`test:only` scripts
// (it self-skips whenever ETH_NODE_URI_mainnet isn't set, which is the case
// for both of those) and only actually runs via `pnpm test:mainnet`, which
// loads that var from ../contracts/.env (the same ETH_NODE_URI_<network>
// convention hardhat/rocketh already use there).
//
// Validates the yieldEveryMs (core/radio.ts) and pause/resume-via-recreate
// (react/use-radio-controller.ts) fixes against genuine high-density logs —
// WETH's Transfer is one of the busiest events on mainnet — rather than only
// the handful of manually-placed logs the rest of the suite's Anvil fixtures
// use.
describe(
	'WETH Transfer volume (real mainnet)',
	{skip: !RPC_URL && 'ETH_NODE_URI_mainnet not set — run via `pnpm test:mainnet`'},
	() => {
		const client = () => createPublicClient({chain: mainnet, transport: http(RPC_URL)});

		it('finds real, dense log volume, yielding a macrotask tick during replay', async () => {
			const provider = createViemAdapter(client());
			const tip = await provider.getBlockNumber();
			const blockRangeLimit = await resolveBlockRangeLimit(provider, tip);
			// A deliberately small lookback relative to the (possibly very small,
			// real-world) blockRangeLimit still forces several dense,
			// fast-resolving chunks in a row — exactly the pathological shape
			// that motivated yieldEveryMs.
			const floorBlock = tip - blockRangeLimit * 20n;
			const cursor = createCursor({
				provider,
				store: createMemoryStore(),
				key: 'weth',
				address: WETH,
				topics: TRANSFER_TOPICS,
				floorBlock,
				blockRangeLimit,
			});

			const originalSetTimeout = globalThis.setTimeout;
			let zeroDelayTicks = 0;
			globalThis.setTimeout = ((fn: () => void, delay?: number) => {
				if (delay === 0) zeroDelayTicks++;
				return originalSetTimeout(fn, delay as number);
			}) as typeof setTimeout;

			const controller = new AbortController();
			let totalLogs = 0;
			try {
				for await (const chunk of radio(cursor, {
					pollIntervalMs: 5,
					yieldEveryMs: 1,
					signal: controller.signal,
				})) {
					totalLogs += chunk.length;
					if (await cursor.isFullyScanned()) {
						controller.abort();
						break;
					}
				}
			} finally {
				globalThis.setTimeout = originalSetTimeout;
			}

			// A loose sanity bound — WETH reliably moves many multiples of this
			// per block on mainnet, so 20 blockRangeLimit-wide windows should
			// turn up well over 20 even in a quiet stretch. Not pinned to an
			// exact figure, which would drift with real chain activity.
			expect(totalLogs > 20).toEqual(true);
			expect(zeroDelayTicks > 0).toEqual(true);
		});

		it('pause (abort) stops further calls; resume continues from the same store', async () => {
			const provider = recordCalls(createViemAdapter(client()));
			const tip = await provider.getBlockNumber();
			const blockRangeLimit = await resolveBlockRangeLimit(provider, tip);
			const floorBlock = tip - blockRangeLimit * 20n;
			const store = createMemoryStore();
			const cursor = createCursor({
				provider,
				store,
				key: 'weth-pause',
				address: WETH,
				topics: TRANSFER_TOPICS,
				floorBlock,
				blockRangeLimit,
			});

			const drain = (signal: AbortSignal) =>
				(async () => {
					for await (const _chunk of radio(cursor, {pollIntervalMs: 5, yieldEveryMs: 5, signal})) {
						// Draining is enough here — assertions read cursor/provider
						// state directly rather than the yielded chunks themselves.
					}
				})();

			let controller = new AbortController();
			const first = drain(controller.signal);
			await new Promise((resolve) => setTimeout(resolve, 1_000));
			controller.abort();
			await first;

			const callsAtPause = provider.calls.length;
			const spansAtPause = await store.load('weth-pause');
			expect((spansAtPause?.length ?? 0) > 0).toEqual(true);

			// "Paused": no new calls go out while nothing is iterating.
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(provider.calls.length).toEqual(callsAtPause);

			// "Resumed": a fresh AbortController + a fresh radio() call against
			// the *same* cursor/store — this is the whole mechanism
			// use-radio-controller.ts's resume() relies on.
			controller = new AbortController();
			const second = drain(controller.signal);
			await new Promise((resolve) => setTimeout(resolve, 1_000));
			controller.abort();
			await second;

			expect(provider.calls.length > callsAtPause).toEqual(true);
			const spansAfterResume = await store.load('weth-pause');
			expect((spansAfterResume?.length ?? 0) > 0).toEqual(true);
		});
	},
);
