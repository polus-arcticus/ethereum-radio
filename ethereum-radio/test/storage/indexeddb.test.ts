import 'fake-indexeddb/auto';
import {describe, it} from 'node:test';
import {expect} from 'earl';
import {createIndexedDbStore} from '../../src/storage/indexeddb.ts';

let dbCounter = 0;
const freshDbName = () => `test:${++dbCounter}`;

describe('createIndexedDbStore', () => {
	it('returns undefined for a key that was never saved', async () => {
		const store = createIndexedDbStore(freshDbName());
		expect(await store.load('missing')).toEqual(undefined);
	});

	it('round-trips saved spans, preserving bigint via structured clone', async () => {
		const store = createIndexedDbStore(freshDbName());
		await store.save('key', [{fromBlock: 100n, toBlock: 200n}]);
		expect(await store.load('key')).toEqual([{fromBlock: 100n, toBlock: 200n}]);
	});

	it('namespaces by database name so multiple stores do not collide', async () => {
		const storeA = createIndexedDbStore(freshDbName());
		const storeB = createIndexedDbStore(freshDbName());
		await storeA.save('key', [{fromBlock: 1n, toBlock: 2n}]);
		expect(await storeB.load('key')).toEqual(undefined);
	});

	it('clears a key', async () => {
		const store = createIndexedDbStore(freshDbName());
		await store.save('key', [{fromBlock: 100n, toBlock: 200n}]);
		await store.clear!('key');
		expect(await store.load('key')).toEqual(undefined);
	});
});
