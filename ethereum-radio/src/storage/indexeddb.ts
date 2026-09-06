import type {Store} from './types.ts';
import type {Span} from '../core/spans.ts';

const DEFAULT_DB_NAME = 'ethereum-radio:spans';
const STORE_NAME = 'spans';

const openDb = (dbName: string): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

// IndexedDB's structured-clone algorithm supports bigint natively, unlike
// JSON — values are stored as-is, no toPortable/fromPortable round-trip
// needed. Generic over the stored value (Span[] by default; also used as
// createIndexedDbStore<Checkpoint[]>() for reorg-check baselines). The
// database is opened lazily on first use, not at construction time, so
// constructing this store has no effect in SSR/Node contexts where the
// indexedDB global doesn't exist.
export const createIndexedDbStore = <T = Span[]>(dbName: string = DEFAULT_DB_NAME): Store<T> => {
	let dbPromise: Promise<IDBDatabase> | undefined;
	const getDb = () => (dbPromise ??= openDb(dbName));

	return {
		load: async (key) => {
			const db = await getDb();
			return new Promise((resolve, reject) => {
				const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
				request.onsuccess = () => resolve(request.result as T | undefined);
				request.onerror = () => reject(request.error);
			});
		},
		save: async (key, value) => {
			const db = await getDb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, 'readwrite');
				tx.objectStore(STORE_NAME).put(value, key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},
		clear: async (key) => {
			const db = await getDb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, 'readwrite');
				tx.objectStore(STORE_NAME).delete(key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},
	};
};
