import type {SpanStore} from './types.ts';
import type {Span} from '../core/spans.ts';
import {toPortable, fromPortable} from '../core/json-bigint.ts';

const DEFAULT_PREFIX = 'ethereum-radio:spans:';

// localStorage-backed store — no dependency beyond the browser global.
// Deferred: IndexedDB and cookie-based stores. Both fit this same interface
// without any change to it or to the cursor engine.
export const createLocalStorageStore = (
	prefix: string = DEFAULT_PREFIX,
): SpanStore => ({
	load: async (key) => {
		const raw = localStorage.getItem(prefix + key);
		return raw == null ? undefined : (fromPortable(JSON.parse(raw)) as Span[]);
	},
	save: async (key, spans) => {
		localStorage.setItem(prefix + key, JSON.stringify(toPortable(spans)));
	},
	clear: async (key) => {
		localStorage.removeItem(prefix + key);
	},
});
