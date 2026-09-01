import {describe, it} from 'node:test';
import {expect} from 'earl';
import {numberToHex} from 'viem';
import {
	clampFromBlock,
	chunkedFetchLogs,
	fetchAllLogs,
} from '../../src/core/chunked-logs.ts';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import {
	LIMITED_RPC_URL,
	readEventFixture,
	createViemTestClients,
	ensureTip,
	recordCalls,
	logValue,
} from '../fixtures/chain-environment.ts';

describe('clampFromBlock', () => {
	it('returns the candidate when it is above the floor', () => {
		expect(clampFromBlock(200n, 100n)).toEqual(200n);
	});

	it('floors the candidate when it is below the floor', () => {
		expect(clampFromBlock(50n, 100n)).toEqual(100n);
	});
});

describe('chunkedFetchLogs (real Anvil)', () => {
	it('throws when blockRangeLimit is not positive', async () => {
		const {publicClient} = createViemTestClients();
		const provider = createViemAdapter(publicClient);
		await expect(
			chunkedFetchLogs(
				provider,
				{address: readEventFixture().address, fromBlock: 0n, toBlock: 10n},
				0n,
			),
		).toBeRejectedWith(/blockRangeLimit must be greater than 0/);
	});

	it('splits a real range into blockRangeLimit-sized windows', async () => {
		const {publicClient} = createViemTestClients();
		const provider = recordCalls(createViemAdapter(publicClient));
		const toBlock = await ensureTip(30n);
		const fromBlock = toBlock - 24n;

		await chunkedFetchLogs(
			provider,
			{address: readEventFixture().address, fromBlock, toBlock},
			10n,
		);

		const windows = provider.calls.map((c) => c.toBlock - c.fromBlock + 1n);
		// 25 blocks in windows of 10: 10, 10, 5.
		expect(windows).toEqual([10n, 10n, 5n]);
		expect(provider.calls[0]!.fromBlock).toEqual(fromBlock);
		expect(provider.calls[provider.calls.length - 1]!.toBlock).toEqual(toBlock);
	});

	it('finds real logs across a range wider than one window', async () => {
		const fixture = readEventFixture();
		const {publicClient} = createViemTestClients();
		const provider = recordCalls(createViemAdapter(publicClient));

		const first = await logValue(700_001n);
		// Mine a few blocks with a non-matching value in between, so the two
		// logs the topics filter cares about land more than one
		// blockRangeLimit window apart.
		for (let i = 0; i < 3; i++) await logValue(700_900n + BigInt(i));
		const last = await logValue(700_002n);

		const result = await chunkedFetchLogs(
			provider,
			{
				address: fixture.address,
				topics: [
					null,
					null,
					[
						numberToHex(700_001n, {size: 32}),
						numberToHex(700_002n, {size: 32}),
					],
				],
				fromBlock: first.blockNumber,
				toBlock: last.blockNumber,
			},
			2n,
		);

		expect(result.map((l) => l.blockNumber)).toEqual([
			first.blockNumber,
			last.blockNumber,
		]);
		expect(provider.calls.length).toBeGreaterThan(1);
	});

	it('rejects if a single unchunked call would exceed the real RPC range limit', async () => {
		const {publicClient} = createViemTestClients(LIMITED_RPC_URL);
		const provider = createViemAdapter(publicClient);

		// The limiter's rejection is pure block-range arithmetic (independent
		// of how far the real chain has actually progressed), so a fixed range
		// well past rpc-limiter's cap always triggers it.
		await expect(
			fetchAllLogs(provider, {
				address: readEventFixture().address,
				fromBlock: 0n,
				toBlock: 1_000n,
			}),
		).toBeRejected();
	});
});

describe('fetchAllLogs (real Anvil)', () => {
	it('makes a single unbounded call and finds a real log', async () => {
		const fixture = readEventFixture();
		const {publicClient} = createViemTestClients();
		const provider = recordCalls(createViemAdapter(publicClient));

		const receipt = await logValue(700_200n);
		const result = await fetchAllLogs(provider, {
			address: fixture.address,
			fromBlock: receipt.blockNumber,
			toBlock: receipt.blockNumber,
		});

		expect(result.length).toEqual(1);
		expect(provider.calls.length).toEqual(1);
	});
});
