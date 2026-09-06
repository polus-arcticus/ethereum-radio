import {useEffect, useMemo, useState, type FormEvent, type ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
	WagmiProvider,
	useConnect,
	useConnectors,
	useConnection,
	useDisconnect,
	usePublicClient,
	useSwitchChain,
} from 'wagmi';
import {isAddress, isHex, keccak256, toBytes, type Hex, type PublicClient} from 'viem';
import {createRadio, type RawLog, type ReorgCheckResult} from '@ethereum-radio/indexer';
import {createViemAdapter} from '@ethereum-radio/indexer/adapters/viem';
import {createMemoryStore} from '@ethereum-radio/indexer/storage/memory';
import type {Cell} from '@ethereum-radio/indexer/core/spans';
import type {Checkpoint} from '@ethereum-radio/indexer/core/checkpoints';
import {wagmiConfig} from '../../lib/wagmi';
import ScanMapGrid from './ScanMapGrid';
import styles from './styles.module.css';

const queryClient = new QueryClient();

export default function TryItWidget(): ReactNode {
	return (
		<WagmiProvider config={wagmiConfig}>
			<QueryClientProvider client={queryClient}>
				<TryItInner />
			</QueryClientProvider>
		</WagmiProvider>
	);
}

function TryItInner() {
	const {isConnected} = useConnection();
	return isConnected ? <ScanForm /> : <ConnectPanel />;
}

function ConnectPanel() {
	const connectors = useConnectors();
	const {mutate: connect, isPending} = useConnect();

	if (connectors.length === 0) {
		return (
			<p>
				No injected wallet detected — install{' '}
				<a href="https://metamask.io" target="_blank" rel="noreferrer">
					MetaMask
				</a>{' '}
				or another browser wallet extension, then reload this page.
			</p>
		);
	}

	return (
		<div className={styles.row}>
			{connectors.map((connector) => (
				<button
					key={connector.id}
					className="button button--primary"
					disabled={isPending}
					onClick={() => connect({connector})}>
					Connect {connector.name}
				</button>
			))}
		</div>
	);
}

// Solidity hashes indexed string/bytes params into keccak256(value) — see
// docs/usage.mdx#filtering-on-hashed-dynamic-types. A raw 32-byte hex value
// is used as-is; anything else is treated as the plain value and hashed.
const toTopic = (raw: string): Hex | null => {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (isHex(trimmed) && trimmed.length === 66) return trimmed;
	return keccak256(toBytes(trimmed));
};

interface ScanConfig {
	address: `0x${string}`;
	topics: (Hex | null)[];
	floorBlock: bigint;
}

function ScanForm() {
	const publicClient = usePublicClient();
	const {chains, mutate: switchChain} = useSwitchChain();
	const {mutate: disconnect} = useDisconnect();
	const {address: account} = useConnection();

	const [address, setAddress] = useState('');
	const [topicInputs, setTopicInputs] = useState(['', '', '']);
	const [lookback, setLookback] = useState('5000');
	const [addressError, setAddressError] = useState<string | null>(null);
	const [scan, setScan] = useState<ScanConfig | null>(null);

	const onSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (!publicClient) return;
		if (!isAddress(address)) {
			setAddressError('Not a valid address');
			return;
		}
		setAddressError(null);
		const tip = await publicClient.getBlockNumber();
		const lookbackBlocks = BigInt(Math.max(0, Number(lookback) || 0));
		const floorBlock = tip > lookbackBlocks ? tip - lookbackBlocks : 0n;
		setScan({address, topics: topicInputs.map(toTopic), floorBlock});
	};

	return (
		<div>
			<div className={styles.row}>
				<span>Connected: {account}</span>
				<button className="button button--secondary button--sm" onClick={() => disconnect()}>
					Disconnect
				</button>
			</div>

			{!publicClient ? (
				<div>
					<p>Your wallet is on a network this demo doesn't support.</p>
					<div className={styles.row}>
						{chains.map((chain) => (
							<button
								key={chain.id}
								className="button button--primary button--sm"
								onClick={() => switchChain({chainId: chain.id})}>
								Switch to {chain.name}
							</button>
						))}
					</div>
				</div>
			) : (
				<form onSubmit={onSubmit} className={styles.form}>
					<label className={styles.field}>
						Contract address
						<input
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							placeholder="0x..."
						/>
						{addressError && <span className={styles.error}>{addressError}</span>}
					</label>
					{topicInputs.map((value, i) => (
						<label className={styles.field} key={i}>
							Topic {i + 1} (optional — plain text gets hashed)
							<input
								value={value}
								onChange={(e) => {
									const next = [...topicInputs];
									next[i] = e.target.value;
									setTopicInputs(next);
								}}
								placeholder={i === 0 ? 'leave blank to match any event' : 'e.g. alice'}
							/>
						</label>
					))}
					<label className={styles.field}>
						Look back this many blocks
						<input
							type="number"
							min="0"
							value={lookback}
							onChange={(e) => setLookback(e.target.value)}
						/>
					</label>
					<button type="submit" className="button button--primary">
						Start scanning
					</button>
				</form>
			)}

			{scan && publicClient && <ResultsPanel publicClient={publicClient} {...scan} />}
		</div>
	);
}

function ResultsPanel({address, topics, floorBlock, publicClient}: ScanConfig & {publicClient: PublicClient}) {
	const [logs, setLogs] = useState<RawLog[]>([]);
	const [fullyScanned, setFullyScanned] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [cells, setCells] = useState<Cell[]>([]);
	const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
	const [reorgResult, setReorgResult] = useState<ReorgCheckResult | null>(null);
	const [reorgChecking, setReorgChecking] = useState(false);

	const radio = useMemo(
		() =>
			createRadio({
				provider: createViemAdapter(publicClient),
				store: createMemoryStore(),
				checkpointStore: createMemoryStore<Checkpoint>(),
				key: `${address}:${topics.join(',')}:${floorBlock}`,
				address,
				topics,
				floorBlock,
				blockRangeLimit: 2_000n, // fixed for this demo — see docs/api/core.mdx for rpc-doctor auto-detection
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[publicClient, address, JSON.stringify(topics), floorBlock],
	);

	useEffect(() => {
		setLogs([]);
		setFullyScanned(false);
		setError(null);
		setCells([]);
		setSelectedCell(null);
		setReorgResult(null);
		const controller = new AbortController();

		// radio only yields non-empty chunks, so a scan with zero matches would
		// never update `fullyScanned`/the scan-map grid via the loop below alone
		// — poll them separately (cheap, store-only reads plus one tip lookup)
		// so the status line and grid stay accurate even when nothing's found.
		const statusInterval = setInterval(() => {
			void publicClient.getBlockNumber().then(async (tip) => {
				setFullyScanned(await radio.isFullyScanned());
				setCells(await radio.getCellStates(tip));
			});
		}, 1_000);

		(async () => {
			try {
				for await (const chunk of radio) {
					if (controller.signal.aborted) break;
					setLogs((prev) => [...chunk, ...prev]);
					setFullyScanned(await radio.isFullyScanned());
				}
			} catch (e) {
				if (!controller.signal.aborted) {
					setError(e instanceof Error ? e : new Error(String(e)));
				}
			}
		})();

		return () => {
			controller.abort();
			clearInterval(statusInterval);
		};
	}, [radio, publicClient]);

	const onCheckForReorg = async () => {
		if (!selectedCell) return;
		setReorgChecking(true);
		setReorgResult(null);
		try {
			const result = await radio.checkForReorg(selectedCell.fromBlock, selectedCell.toBlock);
			setReorgResult(result);
		} catch (e) {
			setError(e instanceof Error ? e : new Error(String(e)));
		} finally {
			setReorgChecking(false);
		}
	};

	return (
		<div className={styles.results}>
			<p>
				{error
					? `Error: ${error.message}`
					: fullyScanned
						? 'Caught up — now watching for new blocks.'
						: 'Scanning history…'}
			</p>
			<p>{logs.length} log(s) found</p>
			<ul className={styles.logList}>
				{logs.slice(0, 50).map((log) => (
					<li key={`${log.transactionHash}-${log.logIndex}`}>
						block {log.blockNumber.toString()} — {log.transactionHash}
					</li>
				))}
			</ul>

			<div className={styles.scanMap}>
				<div className={styles.scanMapHeader}>
					<strong>Scan map</strong>
					<span className={styles.reorgStatus}>
						{selectedCell
							? `chunk ${selectedCell.fromBlock}–${selectedCell.toBlock} selected`
							: 'click a chunk to select it'}
					</span>
				</div>
				<ScanMapGrid cells={cells} selected={selectedCell} onSelect={setSelectedCell} />
				<div className={styles.reorgRow}>
					<button
						type="button"
						className="button button--secondary button--sm"
						disabled={!selectedCell || reorgChecking}
						onClick={onCheckForReorg}>
						{reorgChecking ? 'Checking…' : 'Check for reorgs'}
					</button>
					<span className={styles.reorgStatus}>
						{reorgResult?.status === 'unchecked' &&
							'No baseline recorded yet — one has been established for next time.'}
						{reorgResult?.status === 'ok' && 'No reorg — header hash still matches.'}
						{reorgResult?.status === 'reorged' &&
							`Reorg detected — chunk reindexed, ${reorgResult.logs.length} log(s) found on rescan.`}
					</span>
				</div>
			</div>
		</div>
	);
}
