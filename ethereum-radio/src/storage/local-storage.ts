import type {SpanStore} from './types.ts';

const DEFAULT_PREFIX = 'ethereum-radio:spans:';

// JSON.stringify/parse can't handle bigint natively — suffix bigint values
// as `"123n"` strings on write and reverse it on read. Span only ever has
// two bigint fields, so the narrow /^\d+n$/ match is low-risk even without
// scoping it to known keys.
const replacer = (_key: string, value: unknown) =>
	typeof value === 'bigint' ? `${value}n` : value;
const reviver = (_key: string, value: unknown) =>
	typeof value === 'string' && /^\d+n$/.test(value)
		? BigInt(value.slice(0, -1))
		: value;

// localStorage-backed store — no dependency beyond the browser global.
// Deferred: IndexedDB and cookie-based stores. Both fit this same interface
// without any change to it or to the cursor engine.
export const createLocalStorageStore = (
	prefix: string = DEFAULT_PREFIX,
): SpanStore => ({
	load: async (key) => {
		const raw = localStorage.getItem(prefix + key);
		return raw == null ? undefined : JSON.parse(raw, reviver);
	},
	save: async (key, spans) => {
		localStorage.setItem(prefix + key, JSON.stringify(spans, replacer));
	},
	clear: async (key) => {
		localStorage.removeItem(prefix + key);
	},
});
