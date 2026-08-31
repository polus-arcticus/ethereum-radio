import {describe, it} from 'node:test';
import {expect} from 'earl';
import {createMemoryStore} from '../../src/storage/memory.ts';

describe('createMemoryStore', () => {
	it('returns undefined for a key that was never saved', async () => {
		const store = createMemoryStore();
		expect(await store.load('missing')).toEqual(undefined);
	});

	it('round-trips saved spans', async () => {
		const store = createMemoryStore();
		await store.save('key', [{fromBlock: 100n, toBlock: 200n}]);
		expect(await store.load('key')).toEqual([{fromBlock: 100n, toBlock: 200n}]);
	});

	it('does not let a caller mutate the stored array via the returned reference', async () => {
		const store = createMemoryStore();
		const original = [{fromBlock: 100n, toBlock: 200n}];
		await store.save('key', original);
		original[0]!.toBlock = 999n;
		const loaded = await store.load('key');
		expect(loaded).toEqual([{fromBlock: 100n, toBlock: 200n}]);

		loaded![0]!.toBlock = 999n;
		expect(await store.load('key')).toEqual([{fromBlock: 100n, toBlock: 200n}]);
	});

	it('clears a key', async () => {
		const store = createMemoryStore();
		await store.save('key', [{fromBlock: 100n, toBlock: 200n}]);
		await store.clear!('key');
		expect(await store.load('key')).toEqual(undefined);
	});
});
