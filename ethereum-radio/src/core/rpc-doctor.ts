import type {LogsProvider} from '../adapters/types.ts';

export type RpcDoctorTestStatus = 'idle' | 'running' | 'pass' | 'fail';

export interface RpcDoctorResults {
	getLogs: RpcDoctorTestStatus;
	maxBlockRange: bigint | null;
	logErrors: string[];
}

export const IDLE_RESULTS: RpcDoctorResults = {
	getLogs: 'idle',
	maxBlockRange: null,
	logErrors: [],
};

// Many public RPCs cap eth_getLogs way below the old floor of 100 blocks —
// some as low as 5-10 — so the step-down has to actually probe that far or
// affected users silently land on a range their RPC still rejects.
const RANGE_CANDIDATES: bigint[] = [
	2_000_000n,
	500_000n,
	100_000n,
	50_000n,
	10_000n,
	5_000n,
	1_000n,
	500n,
	100n,
	10n,
	5n,
	1n,
];

// Step-downs through RANGE_CANDIDATES calling provider.getLogs until one
// succeeds, to find the largest block range this RPC reliably handles per
// call. There's no separate "filter" test the way a viem-specific version
// would have (createContractEventFilter + getFilterLogs) — a LogsProvider
// only ever exposes a stateless getLogs, and that's the one primitive
// chunkedFetchLogs actually relies on, so it's the only thing worth probing.
//
// Reports each test's outcome via onUpdate as soon as it's known, rather than
// only returning once the whole (potentially 12-call) step-down finishes —
// against a slow/rate-limited public RPC that step-down alone can take many
// seconds, and a UI that goes silent for that whole span reads as hung.
export async function detectRpcCapabilities(
	provider: LogsProvider,
	address: string,
	toBlock: bigint,
	onUpdate?: (results: RpcDoctorResults) => void,
): Promise<RpcDoctorResults> {
	let results: RpcDoctorResults = {...IDLE_RESULTS, logErrors: []};
	const emit = (patch: Partial<RpcDoctorResults>) => {
		results = {...results, ...patch};
		onUpdate?.(results);
	};
	const pushError = (message: string) =>
		emit({logErrors: [...results.logErrors, message]});

	const smallFrom = toBlock > 10n ? toBlock - 10n : 0n;

	// Test 1: eth_getLogs
	emit({getLogs: 'running'});
	try {
		await provider.getLogs({address, fromBlock: smallFrom, toBlock});
		emit({getLogs: 'pass'});
	} catch (e: any) {
		emit({getLogs: 'fail'});
		pushError(`eth_getLogs: ${e?.message ?? e}`);
		return results;
	}

	// Test 2: max block range (step-down)
	for (const range of RANGE_CANDIDATES) {
		const fromBlock = toBlock > range ? toBlock - range : 0n;
		try {
			await provider.getLogs({address, fromBlock, toBlock});
			emit({maxBlockRange: range});
			break;
		} catch (e: any) {
			pushError(`range ${range.toLocaleString()}: ${e?.message ?? e}`);
		}
	}

	return results;
}

const PHI = (1 + Math.sqrt(5)) / 2;

// Applies a golden-ratio safety margin to a detected max block range, so the
// derived blockRangeLimit stays comfortably under a boundary that may be
// approximate (rate limits, response-size caps) rather than a hard cutoff.
// maxBlockRange is always one of RANGE_CANDIDATES (at most 2,000,000), so
// Number(...) is safe here — don't reuse this pattern for an arbitrary
// chain-scale bigint elsewhere.
export const safeBlockRangeLimit = (maxBlockRange: bigint): bigint => {
	const safe = Math.floor(Number(maxBlockRange) * (1 / PHI + 1 / PHI ** 3));
	return BigInt(Math.max(1, safe));
};
