import type {Span} from '../core/spans.ts';

// A minimal, storage-agnostic persistence contract for scan progress. `key`
// is caller-defined (e.g. `${chainId}:${address}:${topic0}`) — this package
// doesn't prescribe a keying scheme. Implementations are plain, swappable
// modules (memory, local-storage, and later indexeddb/cookie) rather than one
// built-in backend, so a consumer only bundles the one it actually uses.
export interface SpanStore {
	load(key: string): Promise<Span[] | undefined>;
	save(key: string, spans: Span[]): Promise<void>;
	clear?(key: string): Promise<void>;
}
