import {describe, it, beforeEach} from 'node:test';
import {expect} from 'earl';
import {createLocalStorageStore} from '../../src/storage/local-storage.ts';

// A tiny in-memory localStorage shim — enough for this store's get/set/remove
// usage, without pulling in a full DOM environment just for this test.
class MockLocalStorage {
	private map = new Map<string, string>();
	getItem(key: string): string | null {
		return this.map.has(key) ? this.map.get(key)! : null;
	}
	setItem(key: string, value: string): void {
		this.map.set(key, value);
	}
	removeItem(key: string): void {
		this.map.delete(key);
	}
}

beforeEach(() => {
	(globalThis as any).localStorage = new MockLocalStorage();
});

describe('createLocalStorageStore', () => {
	it('returns undefined for a key that was never saved', async () => {
		const store = createLocalStorageStore();
		expect(await store.load('missing')).toEqual(undefined);
	});

	it('round-trips saved spans, preserving bigint through JSON serialization', async () => {
		const store = createLocalStorageStore();
		await store.save('key', [{fromBlock: 100n, toBlock: 200n}]);
		expect(await store.load('key')).toEqual([{fromBlock: 100n, toBlock: 200n}]);
	});

	it('namespaces keys under a prefix so multiple stores do not collide', async () => {
		const storeA = createLocalStorageStore('a:');
		const storeB = createLocalStorageStore('b:');
		await storeA.save('key', [{fromBlock: 1n, toBlock: 2n}]);
		expect(await storeB.load('key')).toEqual(undefined);
	});

	it('clears a key', async () => {
		const store = createLocalStorageStore();
		await store.save('key', [{fromBlock: 100n, toBlock: 200n}]);
		await store.clear!('key');
		expect(await store.load('key')).toEqual(undefined);
	});
});
