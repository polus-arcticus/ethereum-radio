import {describe, it} from 'node:test';
import {expect} from 'earl';
import {
	detectRpcCapabilities,
	safeBlockRangeLimit,
} from '../../src/core/rpc-doctor.ts';
import {createMockLogsProvider} from '../fixtures/mock-logs-provider.ts';

const ADDRESS = '0x0000000000000000000000000000000000000001';

describe('safeBlockRangeLimit', () => {
	it('applies the golden-ratio safety margin', () => {
		// (1/PHI + 1/PHI^3) ≈ 0.8541019662496845
		expect(safeBlockRangeLimit(100_000n)).toEqual(85410n);
	});

	it('floors at 1 even for a tiny detected range', () => {
		expect(safeBlockRangeLimit(1n)).toEqual(1n);
	});
});

describe('detectRpcCapabilities', () => {
	it('steps down through range candidates until one succeeds', async () => {
		// A candidate range R queries an inclusive window of R+1 blocks
		// (fromBlock = toBlock - R), so allow exactly one more than 50_000n to
		// let that candidate (and not the next one down) be the first to pass.
		const provider = createMockLogsProvider({
			logs: [],
			tip: 1_000_000n,
			maxRangePerCall: 50_001n,
		});
		const results = await detectRpcCapabilities(provider, ADDRESS, 1_000_000n);
		expect(results.getLogs).toEqual('pass');
		expect(results.maxBlockRange).toEqual(50_000n);
	});

	it('reports getLogs failure and stops without stepping through ranges', async () => {
		const provider = createMockLogsProvider({
			logs: [],
			tip: 1_000_000n,
			maxRangePerCall: 0n,
		});
		const results = await detectRpcCapabilities(provider, ADDRESS, 1_000_000n);
		expect(results.getLogs).toEqual('fail');
		expect(results.maxBlockRange).toEqual(null);
	});

	it('emits progress via onUpdate as each attempt resolves', async () => {
		const provider = createMockLogsProvider({
			logs: [],
			tip: 1_000_000n,
			maxRangePerCall: 500_001n,
		});
		const updates: Array<{getLogs: string; maxBlockRange: bigint | null}> = [];
		await detectRpcCapabilities(provider, ADDRESS, 1_000_000n, (r) =>
			updates.push({getLogs: r.getLogs, maxBlockRange: r.maxBlockRange}),
		);
		expect(updates.some((u) => u.getLogs === 'running')).toEqual(true);
		expect(updates.some((u) => u.getLogs === 'pass')).toEqual(true);
		expect(updates[updates.length - 1]?.maxBlockRange).toEqual(500_000n);
	});
});
