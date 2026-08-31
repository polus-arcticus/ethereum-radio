import type {Span} from '../core/spans.ts';
import type {SpanStore} from './types.ts';

// Map-based store — the default for tests, SSR, and Node scripts. Defensive
// copies on load/save prevent a caller mutating the returned array from
// corrupting the store's internal state.
export const createMemoryStore = (): SpanStore => {
	const map = new Map<string, Span[]>();
	return {
		load: async (key) => map.get(key)?.map((s) => ({...s})),
		save: async (key, spans) => {
			map.set(
				key,
				spans.map((s) => ({...s})),
			);
		},
		clear: async (key) => {
			map.delete(key);
		},
	};
};
