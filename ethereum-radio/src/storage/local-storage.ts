import type {Store} from './types.ts';
import type {Span} from '../core/spans.ts';
import {toPortable, fromPortable} from '../core/json-bigint.ts';

const DEFAULT_PREFIX = 'ethereum-radio:spans:';

// localStorage-backed store — no dependency beyond the browser global.
// Deferred: a cookie-based store. It fits this same interface without any
// change to it or to the cursor engine. Generic over the stored value (Span[]
// by default; also used as createLocalStorageStore<Checkpoint[]>() for
// reorg-check baselines) — JSON can't represent bigint natively, so
// toPortable/fromPortable round-trips it regardless of which shape is stored.
export const createLocalStorageStore = <T = Span[]>(
	prefix: string = DEFAULT_PREFIX,
): Store<T> => ({
	load: async (key) => {
		const raw = localStorage.getItem(prefix + key);
		return raw == null ? undefined : (fromPortable(JSON.parse(raw)) as T);
	},
	save: async (key, value) => {
		localStorage.setItem(prefix + key, JSON.stringify(toPortable(value)));
	},
	clear: async (key) => {
		localStorage.removeItem(prefix + key);
	},
});
