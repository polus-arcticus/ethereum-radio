import {describe, it, after} from 'node:test';
import {expect} from 'earl';
import {createHeliaLight} from 'helia';
import {json} from '@helia/json';
import {exportSnapshot, importSnapshot} from '../../src/sync/ipfs.ts';
import type {RadioSnapshot} from '../../src/sync/ipfs.ts';

// createHeliaLight() is a pure local, network-free node (in-memory
// blockstore, no libp2p) — @helia/json's add()/get() only touch
// `helia.blockstore` directly, so this is enough for a same-node round-trip
// without spinning up any real IPFS networking.
const helia = await createHeliaLight();
const fs = json(helia);

after(() => helia.stop());

describe('exportSnapshot / importSnapshot', () => {
	it('round-trips a snapshot (including bigints) through a content address', async () => {
		const snapshot: RadioSnapshot = {
			spans: [{fromBlock: 100n, toBlock: 200n}],
			logs: [
				{
					address: '0x0000000000000000000000000000000000000001',
					topics: ['0xtopic'],
					data: '0x',
					blockNumber: 150n,
					transactionHash: '0xtx',
					logIndex: 0,
					blockHash: '0xblock',
					transactionIndex: 0,
				},
			],
		};

		const cid = await exportSnapshot(fs, snapshot);
		const imported = await importSnapshot(fs, cid);

		expect(imported).toEqual(snapshot);
	});

	it('produces the same CID for the same snapshot (content-addressed)', async () => {
		const snapshot: RadioSnapshot = {
			spans: [{fromBlock: 1n, toBlock: 2n}],
			logs: [],
		};

		const cidA = await exportSnapshot(fs, snapshot);
		const cidB = await exportSnapshot(fs, snapshot);

		expect(cidA.toString()).toEqual(cidB.toString());
	});
});
