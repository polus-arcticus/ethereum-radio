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
import {
	encodeEventTopics,
	getAddress,
	isAddress,
	parseAbiItem,
	type AbiEvent,
	type Hex,
	type PublicClient,
} from 'viem';
import {mainnet} from 'wagmi/chains';
import type {ReorgCheckResult} from '@ethereum-radio/indexer';
import {useRadioController} from '@ethereum-radio/indexer/react';
import {createViemAdapter} from '@ethereum-radio/indexer/adapters/viem';
import {createMemoryStore} from '@ethereum-radio/indexer/storage/memory';
import type {Cell} from '@ethereum-radio/indexer/core/spans';
import type {Checkpoint} from '@ethereum-radio/indexer/core/checkpoints';
import type {GetLogsParams, LogsProvider} from '@ethereum-radio/indexer/adapters/types';
import {wagmiConfig} from '../../lib/wagmi';
import ScanMapGrid from './ScanMapGrid';
import RpcDoctorPanel from './RpcDoctorPanel';
import RadioControllerPopover from './RadioControllerPopover';
import styles from './styles.module.css';

const queryClient = new QueryClient();

// Temporary diagnostic aid — logs every real getLogs() window (range,
// duration, result count) to the console. There's currently no way to see
// which window a "stuck" scan is actually blocked on: pause/cancel only take
// effect between chunks (see useRadioController), not inside an in-flight
// request, and radio()/Cursor never surface per-window timing on their own.
// Wrapping the provider here is a zero-footprint way to watch that live
// without touching the published package.
const withDebugLogging = (provider: LogsProvider): LogsProvider => ({
	...provider,
	getLogs: async (params: GetLogsParams) => {
		const {fromBlock, toBlock} = params;
		const width = toBlock - fromBlock + 1n;
		const start = performance.now();
		console.debug(`[radio] → getLogs ${fromBlock}–${toBlock} (${width} blocks)…`);
		try {
			const logs = await provider.getLogs(params);
			console.debug(
				`[radio] ← ${fromBlock}–${toBlock} in ${Math.round(performance.now() - start)}ms, ${logs.length} log(s)`,
			);
			return logs;
		} catch (e) {
			console.debug(
				`[radio] ✗ ${fromBlock}–${toBlock} failed after ${Math.round(performance.now() - start)}ms:`,
				e,
			);
			throw e;
		}
	},
});

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

// `parseAbiItem` needs the human-readable-ABI keyword prefix ("event ...");
// let the field itself just take the bare signature.
const parseEventSignature = (raw: string): AbiEvent | null => {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const item = parseAbiItem(trimmed.startsWith('event ') ? trimmed : `event ${trimmed}`);
	if (item.type !== 'event') throw new Error('Not an event signature');
	return item;
};

type IndexedParam = AbiEvent['inputs'][number] & {name: string};

const isIndexed = (input: AbiEvent['inputs'][number]): input is IndexedParam =>
	'indexed' in input && input.indexed === true && !!input.name;

// Only the ABI types viem's encodeEventTopics can actually turn into a topic:
// dynamic types (string/bytes) get hashed, everything else gets ABI-encoded
// and left-padded to 32 bytes — arrays/tuples aren't supported as topics at
// all (Solidity hashes the whole encoded value for those, which this demo
// doesn't attempt to reproduce).
const coerceIndexedArg = (type: string, raw: string): unknown => {
	if (type === 'bool') return raw.trim().toLowerCase() === 'true';
	if (type.startsWith('uint') || type.startsWith('int')) return BigInt(raw.trim());
	return raw.trim();
};

interface ScanConfig {
	address: `0x${string}`;
	topics: (Hex | Hex[] | null)[];
	floorBlock: bigint;
	blockRangeLimit: bigint;
}

// Prepopulated so the form is never blank on first load — WETH's Transfer
// event on mainnet is a reliably high-volume, well-known example that shows
// results immediately for anyone connected to mainnet. Written lowercase and
// checksummed via getAddress() rather than hand-typed mixed-case, so a typo
// here can't silently produce a wrong-but-valid-looking address.
const EXAMPLE_ADDRESS = getAddress('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
const EXAMPLE_EVENT_SIGNATURE = 'Transfer(address indexed from, address indexed to, uint256 value)';

function ScanForm() {
	const publicClient = usePublicClient();
	const {chains, mutate: switchChain} = useSwitchChain();
	const {mutate: disconnect} = useDisconnect();
	const {address: account, chain, chainId} = useConnection();

	const [address, setAddress] = useState<string>(EXAMPLE_ADDRESS);
	const [eventSignature, setEventSignature] = useState(EXAMPLE_EVENT_SIGNATURE);
	const [argInputs, setArgInputs] = useState<Record<string, string>>({});
	// Absolute block number, not a relative lookback — auto-populated once RPC
	// detection resolves (2x the detected maxBlockRange back from tip), but
	// left editable so a narrower or wider scan can be dialed in directly.
	const [floorBlockInput, setFloorBlockInput] = useState('');
	const [addressError, setAddressError] = useState<string | null>(null);
	const [eventError, setEventError] = useState<string | null>(null);
	const [floorBlockError, setFloorBlockError] = useState<string | null>(null);
	const [scan, setScan] = useState<ScanConfig | null>(null);
	const [probeTip, setProbeTip] = useState<bigint | null>(null);
	const [rpcDetecting, setRpcDetecting] = useState(false);
	const [blockRangeLimit, setBlockRangeLimit] = useState<bigint>(2_000n);

	const provider = useMemo(() => (publicClient ? createViemAdapter(publicClient) : null), [publicClient]);

	// A rough tip is all detectRpcCapabilities needs (it only uses it as the
	// probe's toBlock) — fetched once per publicClient rather than polled, so
	// this doesn't compete with ResultsPanel's own polling once scanning starts.
	useEffect(() => {
		if (!publicClient) return;
		let cancelled = false;
		void publicClient.getBlockNumber().then((t) => {
			if (!cancelled) setProbeTip(t);
		});
		return () => {
			cancelled = true;
		};
	}, [publicClient]);

	const {event, parseError} = useMemo(() => {
		try {
			return {event: parseEventSignature(eventSignature), parseError: null};
		} catch (e) {
			return {event: null, parseError: e instanceof Error ? e.message : String(e)};
		}
	}, [eventSignature]);

	const indexedParams = useMemo(() => (event?.inputs ?? []).filter(isIndexed), [event]);

	const onSubmit = (formEvent: FormEvent) => {
		formEvent.preventDefault();
		if (!publicClient) return;
		if (!isAddress(address)) {
			setAddressError('Not a valid address');
			return;
		}
		setAddressError(null);
		if (!event) {
			setEventError(parseError ?? 'Enter a valid event signature');
			return;
		}
		const args: Record<string, unknown> = {};
		try {
			for (const param of indexedParams) {
				const raw = argInputs[param.name]?.trim();
				if (raw) args[param.name] = coerceIndexedArg(param.type, raw);
			}
		} catch (e) {
			setEventError(e instanceof Error ? e.message : String(e));
			return;
		}
		let topics: (Hex | Hex[] | null)[];
		try {
			topics = encodeEventTopics({abi: [event], eventName: event.name, args});
		} catch (e) {
			setEventError(e instanceof Error ? e.message : String(e));
			return;
		}
		setEventError(null);
		if (!floorBlockInput.trim()) {
			setFloorBlockError('Still waiting on RPC detection to suggest one — or enter a block number manually');
			return;
		}
		let floorBlock: bigint;
		try {
			floorBlock = BigInt(floorBlockInput.trim());
		} catch {
			setFloorBlockError('Not a valid block number');
			return;
		}
		if (floorBlock < 0n) {
			setFloorBlockError('Must be 0 or greater');
			return;
		}
		setFloorBlockError(null);
		setScan({address, topics, floorBlock, blockRangeLimit});
	};

	return (
		<div>
			<div className={styles.row}>
				<span>Connected: {account}</span>
				<button className="button button--secondary button--sm" onClick={() => disconnect()}>
					Disconnect
				</button>
			</div>

			{/* Wallets happily stay on whatever chain they were last pointed at, and a
			    chain like Sepolia is "supported" (publicClient resolves fine) but won't
			    have the prefilled WETH example — so surface the active network any time
			    it isn't mainnet, not only when it's fully unsupported below. */}
			<div className={styles.row}>
				<span>Network: {chain?.name ?? `Unknown (chain ${chainId})`}</span>
				{chainId !== mainnet.id && (
					<button
						className="button button--secondary button--sm"
						onClick={() => switchChain({chainId: mainnet.id})}>
						Switch to {mainnet.name}
					</button>
				)}
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
						Contract address (prefilled with WETH on mainnet — swap in your own)
						<input
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							placeholder="0x..."
						/>
						{addressError && <span className={styles.error}>{addressError}</span>}
					</label>
					{provider && isAddress(address) && probeTip !== null && chainId !== undefined && (
						<RpcDoctorPanel
							provider={provider}
							address={address}
							chainId={chainId}
							tip={probeTip}
							onBlockRangeLimit={setBlockRangeLimit}
							onMaxBlockRange={(range) => {
								if (probeTip === null) return;
								const suggested = probeTip > range * 2n ? probeTip - range * 2n : 0n;
								setFloorBlockInput(suggested.toString());
							}}
							onDetectingChange={setRpcDetecting}
						/>
					)}
					<label className={styles.field}>
						Event signature
						<input
							value={eventSignature}
							onChange={(e) => setEventSignature(e.target.value)}
							placeholder="Transfer(address indexed from, address indexed to, uint256 value)"
						/>
						{eventError && <span className={styles.error}>{eventError}</span>}
					</label>
					{indexedParams.map((param) => (
						<label className={styles.field} key={param.name}>
							{param.type} {param.name} (indexed — optional, leave blank to match any)
							<input
								value={argInputs[param.name] ?? ''}
								onChange={(e) => setArgInputs({...argInputs, [param.name]: e.target.value})}
								placeholder={
									param.type === 'string' || param.type.startsWith('bytes')
										? 'plain text gets hashed'
										: `e.g. ${param.type === 'address' ? '0x...' : '123'}`
								}
							/>
						</label>
					))}
					<label className={styles.field}>
						Floor block (scan won't go back further than this)
						{rpcDetecting && (
							<span className={styles.warning}>
								Waiting on the RPC capabilities probe above — this will be overwritten once it finishes.
							</span>
						)}
						<input
							type="number"
							min="0"
							value={floorBlockInput}
							disabled={rpcDetecting}
							onChange={(e) => setFloorBlockInput(e.target.value)}
						/>
						{floorBlockError && <span className={styles.error}>{floorBlockError}</span>}
					</label>
					<button type="submit" className="button button--primary" disabled={rpcDetecting}>
						Start scanning
					</button>
				</form>
			)}

			{scan && publicClient && <ResultsPanel publicClient={publicClient} {...scan} />}
		</div>
	);
}

// Kept modest — this is what renders, and useRadioController's totalFound
// still counts everything found regardless of this cap.
const LOG_DISPLAY_CAP = 50;

function ResultsPanel({
	address,
	topics,
	floorBlock,
	blockRangeLimit,
	publicClient,
}: ScanConfig & {publicClient: PublicClient}) {
	const scanKey = `${address}:${topics.join(',')}:${floorBlock}`;
	const provider = useMemo(() => withDebugLogging(createViemAdapter(publicClient)), [publicClient]);
	// Held outside useRadioController (which never constructs its own storage,
	// same convention as useCursor) so pause()/resume() reuse the same
	// progress rather than losing it — stable per scanKey, not per
	// blockRangeLimit, since that's fixed once a scan starts anyway.
	const store = useMemo(() => createMemoryStore(), [scanKey]);
	const checkpointStore = useMemo(() => createMemoryStore<Checkpoint>(), [scanKey]);

	const [cells, setCells] = useState<Cell[]>([]);
	const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
	const [reorgResult, setReorgResult] = useState<ReorgCheckResult | null>(null);
	const [reorgError, setReorgError] = useState<Error | null>(null);
	const [reorgChecking, setReorgChecking] = useState(false);

	const {status, logs, totalFound, isTakingAWhile, elapsedMs, error, pause, resume, cancel, cursor} =
		useRadioController({
			provider,
			store,
			checkpointStore,
			key: scanKey,
			address,
			topics,
			floorBlock,
			blockRangeLimit, // detected via RpcDoctorPanel — see docs/api/core.mdx#detectrpccapabilities
			logCap: LOG_DISPLAY_CAP,
		});

	// getCellStates() is Cursor surface, not stream/control surface — useRadioController
	// deliberately doesn't duplicate it (see that hook's UseRadioControllerResult
	// comment), so the scan-map grid polls the same underlying cursor directly.
	useEffect(() => {
		setSelectedCell(null);
		setReorgResult(null);
		setReorgError(null);
		const interval = setInterval(() => {
			void publicClient.getBlockNumber().then(async (tip) => {
				setCells(await cursor.getCellStates(tip));
			});
		}, 1_000);
		return () => clearInterval(interval);
	}, [cursor, publicClient]);

	const onCheckForReorg = async () => {
		if (!selectedCell) return;
		setReorgChecking(true);
		setReorgResult(null);
		setReorgError(null);
		try {
			const result = await cursor.checkForReorg(selectedCell.fromBlock, selectedCell.toBlock);
			setReorgResult(result);
		} catch (e) {
			setReorgError(e instanceof Error ? e : new Error(String(e)));
		} finally {
			setReorgChecking(false);
		}
	};

	return (
		<div className={styles.results}>
			<RadioControllerPopover
				status={status}
				elapsedMs={elapsedMs}
				totalFound={totalFound}
				isTakingAWhile={isTakingAWhile}
				pause={pause}
				resume={resume}
				cancel={cancel}
			/>
			<p>
				{error
					? `Error: ${error.message}`
					: status === 'caught-up'
						? 'Caught up — now watching for new blocks.'
						: status === 'paused'
							? 'Paused.'
							: status === 'cancelled'
								? 'Cancelled.'
								: 'Scanning history…'}
			</p>
			<p>
				{totalFound} log(s) found
				{totalFound > logs.length && ` (showing the most recent ${logs.length})`}
			</p>
			<ul className={styles.logList}>
				{logs.map((log) => (
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
						{reorgError && `Error: ${reorgError.message}`}
						{!reorgError && reorgResult?.status === 'unchecked' &&
							'No baseline recorded yet — one has been established for next time.'}
						{!reorgError && reorgResult?.status === 'ok' && 'No reorg — header hash still matches.'}
						{!reorgError && reorgResult?.status === 'reorged' &&
							`Reorg detected — chunk reindexed, ${reorgResult.logs.length} log(s) found on rescan.`}
					</span>
				</div>
			</div>
		</div>
	);
}
