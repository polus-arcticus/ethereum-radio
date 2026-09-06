import {describe, it} from 'node:test';
import {expect} from 'earl';
import {keccak256, toBytes, numberToHex, decodeAbiParameters} from 'viem';
import {createViemAdapter} from '../../src/adapters/viem.ts';
import {
	readEventFixture,
	createViemTestClients,
	logValue,
	logName,
	logData,
	logCombo,
} from '../fixtures/chain-environment.ts';

// Real Anvil, deployed EventFixture contract — see
// scripts/test-with-anvil.sh and test/fixtures/chain-environment.ts. A mock
// LogsProvider can't exercise indexed dynamic-type topics correctly (their
// topic is keccak256(value), not the value itself) since it just echoes back
// whatever RawLog it's handed — only a real EVM (or these hash computations
// against real logs) proves the adapter decodes them right.
const topic0 = (signature: string) => keccak256(toBytes(signature));

const VALUE_LOGGED = topic0('ValueLogged(address,uint256,uint256)');
const NAMED_LOGGED = topic0('NamedLogged(address,string,string)');
const DATA_LOGGED = topic0('DataLogged(address,bytes,bytes)');
const COMBO = topic0('Combo(address,uint256,string,uint256)');

describe('createViemAdapter (real Anvil)', () => {
	it('passes getBlockNumber through to the real chain', async () => {
		const {publicClient} = createViemTestClients();
		const adapter = createViemAdapter(publicClient);
		expect(await adapter.getBlockNumber()).toEqual(
			await publicClient.getBlockNumber(),
		);
	});

	it('fetches a real block hash by number', async () => {
		const {publicClient} = createViemTestClients();
		const adapter = createViemAdapter(publicClient);
		const tip = await adapter.getBlockNumber();
		const expected = await publicClient.getBlock({blockNumber: tip});
		expect(await adapter.getBlockHash!(tip)).toEqual(expected.hash);
	});

	it('fetches a real log and normalizes it into RawLog', async () => {
		const fixture = readEventFixture();
		const {publicClient} = createViemTestClients();
		const adapter = createViemAdapter(publicClient);

		const receipt = await logValue(999_001n);
		const expected = receipt.logs[0]!;

		const logs = await adapter.getLogs({
			address: fixture.address,
			topics: [VALUE_LOGGED, null, numberToHex(999_001n, {size: 32})],
			fromBlock: receipt.blockNumber,
			toBlock: receipt.blockNumber,
		});

		expect(logs.length).toEqual(1);
		const [log] = logs;
		expect(log!.address.toLowerCase()).toEqual(fixture.address.toLowerCase());
		expect(log!.topics).toEqual(expected.topics as string[]);
		expect(log!.data).toEqual(expected.data);
		expect(log!.blockNumber).toEqual(receipt.blockNumber);
		expect(log!.transactionHash).toEqual(receipt.transactionHash);
		expect(log!.blockHash).toEqual(receipt.blockHash);
		expect(typeof log!.logIndex).toEqual('number');
		expect(typeof log!.transactionIndex).toEqual('number');
	});

	it('filters by a keccak256 topic hash for an indexed string', async () => {
		const fixture = readEventFixture();
		const {publicClient} = createViemTestClients();
		const adapter = createViemAdapter(publicClient);

		const aliceReceipt = await logName('alice', 'hi');
		const bobReceipt = await logName('bob', 'yo');
		const aliceTopic = keccak256(toBytes('alice'));

		const logs = await adapter.getLogs({
			address: fixture.address,
			topics: [NAMED_LOGGED, null, aliceTopic],
			fromBlock: aliceReceipt.blockNumber,
			toBlock: bobReceipt.blockNumber,
		});

		expect(logs.length).toEqual(1);
		expect(logs[0]!.blockNumber).toEqual(aliceReceipt.blockNumber);
		expect(logs[0]!.topics[2]).toEqual(aliceTopic);
	});

	it('filters by a keccak256 topic hash for indexed bytes', async () => {
		const fixture = readEventFixture();
		const {publicClient} = createViemTestClients();
		const adapter = createViemAdapter(publicClient);

		const payload: `0x${string}` = '0xdeadbeef';
		const receipt = await logData(payload);
		const payloadTopic = keccak256(payload);

		const logs = await adapter.getLogs({
			address: fixture.address,
			topics: [DATA_LOGGED, null, payloadTopic],
			fromBlock: receipt.blockNumber,
			toBlock: receipt.blockNumber,
		});

		expect(logs.length).toEqual(1);
		// data holds the non-indexed `bytes payload` param, ABI-encoded (offset +
		// length + content) — unlike the indexed copy, which is just its hash.
		const [decoded] = decodeAbiParameters(
			[{type: 'bytes'}],
			logs[0]!.data as `0x${string}`,
		);
		expect(decoded).toEqual(payload);
	});

	it('filters on a combined exact-value topic and a hash-of-string topic', async () => {
		const fixture = readEventFixture();
		const {publicClient} = createViemTestClients();
		const adapter = createViemAdapter(publicClient);

		const matchReceipt = await logCombo(7n, 'carol');
		const mismatchValueReceipt = await logCombo(8n, 'carol');
		const carolTopic = keccak256(toBytes('carol'));

		const logs = await adapter.getLogs({
			address: fixture.address,
			topics: [COMBO, null, numberToHex(7n, {size: 32}), carolTopic],
			fromBlock: matchReceipt.blockNumber,
			toBlock: mismatchValueReceipt.blockNumber,
		});

		expect(logs.length).toEqual(1);
		expect(logs[0]!.blockNumber).toEqual(matchReceipt.blockNumber);
	});
});
