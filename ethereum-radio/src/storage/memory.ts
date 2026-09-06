import type {Span} from '../core/spans.ts';
import type {Store} from './types.ts';

// Map-based store — the default for tests, SSR, and Node scripts. Defensive
// copies on load/save prevent a caller mutating the returned array from
// corrupting the store's internal state. Generic over the array element type
// so the same factory backs both spans (the default) and, e.g., checkpoints.
export const createMemoryStore = <E extends object = Span>(): Store<E[]> => {
	const map = new Map<string, E[]>();
	return {
		load: async (key) => map.get(key)?.map((item) => ({...item})),
		save: async (key, value) => {
			map.set(
				key,
				value.map((item) => ({...item})),
			);
		},
		clear: async (key) => {
			map.delete(key);
		},
	};
};
