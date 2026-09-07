import {useEffect, useState, type ReactNode} from 'react';
import {
	detectRpcCapabilities,
	safeBlockRangeLimit,
	IDLE_RESULTS,
	type RpcDoctorResults,
} from '@ethereum-radio/indexer';
import type {LogsProvider} from '@ethereum-radio/indexer/adapters/types';
import styles from './styles.module.css';

// Matches the fallback in docs/api/core.mdx's detectRpcCapabilities usage
// example — used when every step-down width fails outright.
const FALLBACK_BLOCK_RANGE_LIMIT = 2_000n;

interface RpcDoctorPanelProps {
	provider: LogsProvider;
	address: string;
	chainId: number;
	tip: bigint;
	onBlockRangeLimit: (limit: bigint) => void;
	onMaxBlockRange?: (range: bigint) => void;
	onDetectingChange?: (detecting: boolean) => void;
}

// Runs detectRpcCapabilities against the connected wallet's own RPC (rather
// than assuming a fixed blockRangeLimit, as this demo did before) and feeds
// the result up to the scan form.
export default function RpcDoctorPanel({
	provider,
	address,
	chainId,
	tip,
	onBlockRangeLimit,
	onMaxBlockRange,
	onDetectingChange,
}: RpcDoctorPanelProps): ReactNode {
	const [results, setResults] = useState<RpcDoctorResults>(IDLE_RESULTS);
	const [detecting, setDetecting] = useState(true);
	// Bumped by the "Retry" button to force a fresh probe without changing
	// chainId/address (e.g. after the RPC seemed to time out).
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		onDetectingChange?.(detecting);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [detecting]);

	useEffect(() => {
		let cancelled = false;
		setResults(IDLE_RESULTS);
		setDetecting(true);
		void detectRpcCapabilities(provider, address, tip, (progress) => {
			if (!cancelled) setResults(progress);
		}).then((final) => {
			if (cancelled) return;
			setDetecting(false);
			onBlockRangeLimit(final.maxBlockRange ? safeBlockRangeLimit(final.maxBlockRange) : FALLBACK_BLOCK_RANGE_LIMIT);
			// The raw detected width (not the fencepost-adjusted blockRangeLimit)
			// — a reasonable default "how far back to scan" since it's the
			// widest single window this RPC proved it can serve.
			if (final.maxBlockRange) onMaxBlockRange?.(final.maxBlockRange);
		});
		return () => {
			cancelled = true;
		};
		// Deliberately keyed on chainId/address (stable primitives) rather than
		// the `provider` object — wagmi's unstable_connector transport can hand
		// back a differently-identitied client across renders for the *same*
		// underlying chain/RPC, which previously restarted this whole 12-step
		// probe from scratch on every unrelated keystroke in the form,
		// permanently stalling it a few candidates in.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [chainId, address, attempt]);

	const limit = results.maxBlockRange !== null ? safeBlockRangeLimit(results.maxBlockRange) : null;

	return (
		<div className={styles.rpcDoctor}>
			<strong>RPC capabilities</strong>
			<span className={styles.reorgStatus}>
				eth_getLogs: {results.getLogs}
				{results.maxBlockRange !== null && ` — widest range that worked: ${results.maxBlockRange.toLocaleString()} blocks`}
			</span>
			<span className={styles.reorgStatus}>
				blockRangeLimit for this scan: {(limit ?? FALLBACK_BLOCK_RANGE_LIMIT).toLocaleString()}
				{limit
					? ' (one block below the detected max)'
					: detecting
						? ' (probing — stepping down through range widths, down to 1 block if needed…)'
						: ' (fallback — every candidate width down to 1 block failed)'}
			</span>
			{results.logErrors.length > 0 && (
				<details>
					<summary className={styles.reorgStatus}>{results.logErrors.length} probe error(s)</summary>
					<ul className={styles.rpcDoctorErrors}>
						{results.logErrors.map((err, i) => (
							<li key={i}>{err}</li>
						))}
					</ul>
				</details>
			)}
			{!detecting && (
				<button
					type="button"
					className="button button--secondary button--sm"
					onClick={() => setAttempt((n) => n + 1)}>
					Re-run probe
				</button>
			)}
		</div>
	);
}
