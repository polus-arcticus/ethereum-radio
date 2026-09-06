import type {Span} from '../core/spans.ts';

// A minimal, storage-agnostic persistence contract, generic over what's
// being persisted (Span[] for scan progress, Checkpoint[] for reorg-check
// baselines, ...). `key` is caller-defined (e.g.
// `${chainId}:${address}:${topic0}`) — this package doesn't prescribe a
// keying scheme. Implementations are plain, swappable modules (memory,
// local-storage, indexeddb, and later cookie) rather than one built-in
// backend, so a consumer only bundles the one it actually uses, and each
// factory works for any T (a checkpoint store is just createMemoryStore<Checkpoint[]>()).
export interface Store<T> {
	load(key: string): Promise<T | undefined>;
	save(key: string, value: T): Promise<void>;
	clear?(key: string): Promise<void>;
}

// The original, narrower name — kept as an alias since this is what scan
// progress specifically is stored as, and what every doc/example refers to.
export type SpanStore = Store<Span[]>;
