import type {CID} from 'multiformats/cid';
import type {Span} from '../core/spans.ts';
import type {RawLog} from '../adapters/types.ts';
import {toPortable, fromPortable} from '../core/json-bigint.ts';

export interface RadioSnapshot {
	spans: Span[];
	logs: RawLog[];
}

// Structural, not a hard import of @helia/json's own types — mirrors the
// LogsProvider/SpanStore duck-typing pattern used elsewhere in this package.
// Satisfied by `json(helia)` from '@helia/json' (`import {json} from
// '@helia/json'; const jsonStore = json(helia);`).
export interface JsonBlockstore {
	add(value: unknown): Promise<CID>;
	get<T = unknown>(cid: CID): Promise<T>;
}

// "Comes out the back" — after some scanning, hand the consumer's own
// accumulated spans + logs to IPFS as one content-addressed snapshot they can
// pin/share. Nothing here touches Cursor/radio(); Helia stays entirely
// outside the core path.
export const exportSnapshot = async (
	fs: JsonBlockstore,
	snapshot: RadioSnapshot,
): Promise<CID> => fs.add(toPortable(snapshot));

// "Brought in from the top" — fetch a previously exported snapshot so a new
// client can prefill a SpanStore (via `store.save(key, snapshot.spans)`)
// before starting radio(), instead of re-scanning that history over RPC.
// What the consumer does with `snapshot.logs` (render them, cache them) is
// entirely up to them — this module has no opinion on app-level log storage.
export const importSnapshot = async (
	fs: JsonBlockstore,
	cid: CID,
): Promise<RadioSnapshot> => fromPortable(await fs.get(cid)) as RadioSnapshot;
