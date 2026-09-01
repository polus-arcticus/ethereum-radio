// JSON can't represent bigint natively — suffix bigint values as `"123n"`
// strings on the way out and reverse it on the way in. Deep-walks
// objects/arrays so it works on any bigint-bearing structure (Span[],
// RawLog[], or a snapshot bundling both), not just a single flat record.
// Narrow /^\d+n$/ match is a low-risk heuristic given this package's actual
// data shapes (block numbers, never arbitrary user strings shaped like "5n").
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const toPortable = (value: unknown): unknown => {
	if (typeof value === 'bigint') return `${value}n`;
	if (Array.isArray(value)) return value.map(toPortable);
	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, toPortable(v)]),
		);
	}
	return value;
};

export const fromPortable = (value: unknown): unknown => {
	if (typeof value === 'string' && /^\d+n$/.test(value)) {
		return BigInt(value.slice(0, -1));
	}
	if (Array.isArray(value)) return value.map(fromPortable);
	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, fromPortable(v)]),
		);
	}
	return value;
};
