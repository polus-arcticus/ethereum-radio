// A sparse "last known-canonical hash" record per block number, for
// detecting a chain reorg. A mined block's hash commits to every block below
// it via parentHash-chaining, so comparing a block's current hash against a
// previously recorded one for the same block number reveals whether that
// block — or anything before it — was replaced, without needing a hash for
// every block, only at points worth checking (e.g. the top of a scan-map
// chunk).
export interface Checkpoint {
	blockNumber: bigint;
	hash: string;
}

const byBlockNumber = (a: Checkpoint, b: Checkpoint) =>
	a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0;

// Insert or replace the checkpoint for a given block number, keeping the
// list sorted by blockNumber.
export const recordCheckpoint = (
	checkpoints: Checkpoint[],
	checkpoint: Checkpoint,
): Checkpoint[] =>
	[
		...checkpoints.filter((c) => c.blockNumber !== checkpoint.blockNumber),
		checkpoint,
	].sort(byBlockNumber);

export const findCheckpoint = (
	checkpoints: Checkpoint[],
	blockNumber: bigint,
): Checkpoint | undefined =>
	checkpoints.find((c) => c.blockNumber === blockNumber);

// Drop any checkpoint at or above fromBlock — used when a reorg invalidates
// a range, so a stale checkpoint inside it can't be compared against later.
export const removeCheckpointsFrom = (
	checkpoints: Checkpoint[],
	fromBlock: bigint,
): Checkpoint[] => checkpoints.filter((c) => c.blockNumber < fromBlock);
