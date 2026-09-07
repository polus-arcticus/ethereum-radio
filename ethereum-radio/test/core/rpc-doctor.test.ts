import {describe, it} from 'node:test';
import {expect} from 'earl';
import {
	detectRpcCapabilities,
	safeBlockRangeLimit,
} from '../../src/core/rpc-doctor.ts';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import {
	LIMITED_RPC_URL,
	readEventFixture,
	createViemTestClients,
	ensureTip,
} from '../fixtures/chain-environment.ts';

describe('safeBlockRangeLimit', () => {
	it('backs off one block as a fencepost guard', () => {
		expect(safeBlockRangeLimit(100_000n)).toEqual(99_999n);
	});

	it('floors at 1 even for a tiny detected range', () => {
		expect(safeBlockRangeLimit(1n)).toEqual(1n);
	});
});

// rpc-doctor's RANGE_CANDIDATES top out at 2,000,000 — far beyond what a
// fresh local Anvil chain has actually mined. Anvil rejects an eth_getLogs
// toBlock beyond its real height outright (BlockOutOfRangeError), so instead
// of faking a tall chain, these tests fast-forward the real one with
// chain-environment's ensureTip/anvil_mine (a real cheatcode, not a
// log/provider mock) to a comfortable height before probing —
// order-independent of whatever earlier test files already mined.
describe('detectRpcCapabilities (real Anvil, via rpc-limiter)', () => {
	it('steps down through range candidates until one succeeds', async () => {
		const tip = await ensureTip(300n);
		const {publicClient} = createViemTestClients(LIMITED_RPC_URL);
		const provider = createViemAdapter(publicClient);

		const results = await detectRpcCapabilities(
			provider,
			readEventFixture().address,
			tip,
		);

		expect(results.getLogs).toEqual('pass');
		// rpc-limiter's MAX_LOG_RANGE (docker-compose.test.yml) is pinned to 10,
		// which is itself one of RANGE_CANDIDATES — the step-down should land
		// exactly there.
		expect(results.maxBlockRange).toEqual(10n);
	});

	it('reports getLogs failure and stops without stepping through ranges', async () => {
		// An unreachable RPC — a real connection failure, not a simulated one.
		const {publicClient} = createViemTestClients('http://127.0.0.1:8599');
		const provider = createViemAdapter(publicClient);

		const results = await detectRpcCapabilities(
			provider,
			readEventFixture().address,
			1_000n,
		);
		expect(results.getLogs).toEqual('fail');
		expect(results.maxBlockRange).toEqual(null);
	});

	it('emits progress via onUpdate as each attempt resolves', async () => {
		const tip = await ensureTip(300n);
		const {publicClient} = createViemTestClients(LIMITED_RPC_URL);
		const provider = createViemAdapter(publicClient);

		const updates: Array<{getLogs: string; maxBlockRange: bigint | null}> = [];
		await detectRpcCapabilities(
			provider,
			readEventFixture().address,
			tip,
			(r) => updates.push({getLogs: r.getLogs, maxBlockRange: r.maxBlockRange}),
		);

		expect(updates.some((u) => u.getLogs === 'running')).toEqual(true);
		expect(updates.some((u) => u.getLogs === 'pass')).toEqual(true);
		expect(updates[updates.length - 1]?.maxBlockRange).toEqual(10n);
	});
});
