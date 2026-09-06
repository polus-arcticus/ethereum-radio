import {describe, it} from 'node:test';
import {expect} from 'earl';
import {keccak256, toUtf8Bytes, AbiCoder, zeroPadValue, toBeHex} from 'ethers';
import {createEthersAdapter} from '../../src/adapters/ethers.ts';
import {
	readEventFixture,
	createEthersTestSigner,
	logValue,
	logName,
	logData,
	logCombo,
} from '../fixtures/chain-environment.ts';

// Real Anvil, deployed EventFixture contract — see
// scripts/test-with-anvil.sh and test/fixtures/chain-environment.ts. Same
// rationale as the viem adapter tests: a mock LogsProvider can't exercise
// indexed dynamic-type topics (keccak256(value), not the value itself)
// correctly since it just echoes back whatever RawLog it's handed.
const topic0 = (signature: string) => keccak256(toUtf8Bytes(signature));
const valueTopic = (value: bigint) => zeroPadValue(toBeHex(value), 32);

const VALUE_LOGGED = topic0('ValueLogged(address,uint256,uint256)');
const NAMED_LOGGED = topic0('NamedLogged(address,string,string)');
const DATA_LOGGED = topic0('DataLogged(address,bytes,bytes)');
const COMBO = topic0('Combo(address,uint256,string,uint256)');

describe('createEthersAdapter (real Anvil)', () => {
	it('wraps getBlockNumber() as bigint against the real chain', async () => {
		const {provider} = createEthersTestSigner();
		const adapter = createEthersAdapter(provider);
		const tip = await adapter.getBlockNumber();
		expect(tip).toEqual(BigInt(await provider.getBlockNumber()));
	});

	it('fetches a real block hash by number', async () => {
		const {provider} = createEthersTestSigner();
		const adapter = createEthersAdapter(provider);
		const tip = await adapter.getBlockNumber();
		const expected = await provider.getBlock(Number(tip));
		expect(await adapter.getBlockHash!(tip)).toEqual(expected!.hash);
	});

	it('fetches a real log and normalizes it into RawLog', async () => {
		const fixture = readEventFixture();
		const {provider} = createEthersTestSigner();
		const adapter = createEthersAdapter(provider);

		const receipt = await logValue(999_002n);

		const logs = await adapter.getLogs({
			address: fixture.address,
			topics: [VALUE_LOGGED, null, valueTopic(999_002n)],
			fromBlock: receipt.blockNumber,
			toBlock: receipt.blockNumber,
		});

		expect(logs.length).toEqual(1);
		const [log] = logs;
		expect(log!.address.toLowerCase()).toEqual(fixture.address.toLowerCase());
		expect(log!.blockNumber).toEqual(receipt.blockNumber);
		expect(log!.transactionHash).toEqual(receipt.transactionHash);
		expect(log!.blockHash).toEqual(receipt.blockHash);
		expect(typeof log!.logIndex).toEqual('number');
		expect(typeof log!.transactionIndex).toEqual('number');
	});

	it('filters by a keccak256 topic hash for an indexed string', async () => {
		const fixture = readEventFixture();
		const {provider} = createEthersTestSigner();
		const adapter = createEthersAdapter(provider);

		const aliceReceipt = await logName('alice-ethers', 'hi');
		const bobReceipt = await logName('bob-ethers', 'yo');
		const aliceTopic = keccak256(toUtf8Bytes('alice-ethers'));

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
		const {provider} = createEthersTestSigner();
		const adapter = createEthersAdapter(provider);

		const payload = '0xc0ffee';
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
		const [decoded] = AbiCoder.defaultAbiCoder().decode(
			['bytes'],
			logs[0]!.data,
		);
		expect(decoded).toEqual(payload);
	});

	it('filters on a combined exact-value topic and a hash-of-string topic', async () => {
		const fixture = readEventFixture();
		const {provider} = createEthersTestSigner();
		const adapter = createEthersAdapter(provider);

		const matchReceipt = await logCombo(7n, 'carol-ethers');
		const mismatchValueReceipt = await logCombo(8n, 'carol-ethers');
		const carolTopic = keccak256(toUtf8Bytes('carol-ethers'));

		const logs = await adapter.getLogs({
			address: fixture.address,
			topics: [COMBO, null, valueTopic(7n), carolTopic],
			fromBlock: matchReceipt.blockNumber,
			toBlock: mismatchValueReceipt.blockNumber,
		});

		expect(logs.length).toEqual(1);
		expect(logs[0]!.blockNumber).toEqual(matchReceipt.blockNumber);
	});
});
