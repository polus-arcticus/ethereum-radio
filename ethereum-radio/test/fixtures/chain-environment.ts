import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {
	createPublicClient,
	createWalletClient,
	getContract,
	http,
	type Abi,
	type PublicClient,
	type WalletClient,
} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {JsonRpcProvider, Wallet} from 'ethers';
import type {GetLogsParams, LogsProvider} from '../../src/adapters/types.ts';

// Real Anvil (via docker-compose.test.yml), not a mock — see
// scripts/test-with-anvil.sh, which brings the chain up, deploys
// contracts/src/EventFixture/EventFixture.sol against it, then runs the
// suite. RPC_URL is the direct anvil endpoint; LIMITED_RPC_URL goes through
// docker/rpc-limiter, which rejects eth_getLogs calls wider than
// MAX_LOG_RANGE (docker-compose.test.yml) the way a real rate-limited RPC —
// something Anvil itself doesn't do.
//
// Every test file writes from the same deployer account against the same
// shared, never-reset chain — package.json's `test:only` runs with
// `--test-concurrency=1` so files execute one at a time and never race each
// other's nonces (tests within one file already run serially by default).
export const RPC_URL = 'http://127.0.0.1:8545';
export const LIMITED_RPC_URL = 'http://127.0.0.1:8546';

// Anvil's default account #0 for the well-known "test test test ... junk"
// mnemonic docker-compose.test.yml pins — deterministic across every run.
export const DEPLOYER_PRIVATE_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DeployedFixture {
	address: `0x${string}`;
	abi: Abi;
}

// Reads the artifact contracts/deploy/002_deploy_event_fixture.ts writes via
// rocketh/hardhat-deploy — guaranteed to exist after any `deploy --network
// localhost` run, regardless of any separate export config.
export const readEventFixture = (): DeployedFixture => {
	const path = join(
		__dirname,
		'../../../contracts/deployments/localhost/EventFixture.json',
	);
	const raw = JSON.parse(readFileSync(path, 'utf8'));
	return {address: raw.address, abi: raw.abi};
};

// cacheTime: 0 matters a lot here — without an explicit `chain` config, viem
// defaults getBlockNumber() to a 4s cacheTime, so a fast poll loop (e.g.
// radio()'s default-4s-but-here-5ms pollIntervalMs) would keep reading a
// stale tip for up to 4 real seconds after a new block actually lands. A
// consumer building a fast-polling radio() against viem in a real app should
// configure the same on their own client for the same reason — this isn't
// an adapter-level concern (createViemAdapter never touches client config),
// only a real caching behavior a mock could never have surfaced.
export const createViemTestClients = (
	rpcUrl: string = RPC_URL,
): {publicClient: PublicClient; walletClient: WalletClient} => {
	const account = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
	const transport = http(rpcUrl);
	return {
		publicClient: createPublicClient({transport, cacheTime: 0}) as PublicClient,
		walletClient: createWalletClient({account, transport}) as WalletClient,
	};
};

// An address with no deployed code and no logs ever emitted against it —
// for tests whose span math doesn't depend on real log content, only on a
// real getBlockNumber()/getLogs() round trip.
export const EMPTY_ADDRESS = '0x0000000000000000000000000000000000000002';

export const getTip = async (): Promise<bigint> => {
	const {publicClient} = createViemTestClients();
	return publicClient.getBlockNumber();
};

// Fast-forwards the real chain via Anvil's anvil_mine cheatcode (near-
// instant — it mines empty blocks, no real work) rather than waiting for
// real time to pass or submitting throwaway transactions.
export const mineBlocks = async (count: bigint): Promise<bigint> => {
	if (count <= 0n) return getTip();
	const {publicClient} = createViemTestClients();
	await publicClient.request({
		method: 'anvil_mine',
		params: [`0x${count.toString(16)}`],
	} as Parameters<typeof publicClient.request>[0]);
	return publicClient.getBlockNumber();
};

// Mines forward until the tip is at least minHeight — order-independent of
// whatever earlier test files already mined.
export const ensureTip = async (minHeight: bigint): Promise<bigint> => {
	const tip = await getTip();
	return tip < minHeight ? mineBlocks(minHeight - tip) : tip;
};

export const createEthersTestSigner = (
	rpcUrl: string = RPC_URL,
): {provider: JsonRpcProvider; signer: Wallet} => {
	const provider = new JsonRpcProvider(rpcUrl);
	const signer = new Wallet(DEPLOYER_PRIVATE_KEY, provider);
	return {provider, signer};
};

// Thin write helpers around the deployed EventFixture, each returning the
// real viem tx receipt (bigint blockNumber, `logIndex`-named log entries —
// matching this package's own RawLog convention) so a test knows exactly
// which block its log landed in. Always written via viem regardless of
// which adapter a given test file is exercising for reads — what matters is
// producing real chain data, not which client library does the writing.
const eventFixtureWriteContract = () => {
	const fixture = readEventFixture();
	const {publicClient, walletClient} = createViemTestClients();
	return getContract({
		address: fixture.address,
		abi: fixture.abi,
		client: {public: publicClient, wallet: walletClient},
	});
};

const waitForWrite = async (hash: `0x${string}`) => {
	const {publicClient} = createViemTestClients();
	return publicClient.waitForTransactionReceipt({hash});
};

export const logValue = async (value: bigint) => {
	const hash = await eventFixtureWriteContract().write.logValue([value]);
	return waitForWrite(hash);
};

export const logName = async (name: string, data: string) => {
	const hash = await eventFixtureWriteContract().write.logName([name, data]);
	return waitForWrite(hash);
};

export const logData = async (payload: `0x${string}`) => {
	const hash = await eventFixtureWriteContract().write.logData([payload]);
	return waitForWrite(hash);
};

export const logCombo = async (value: bigint, name: string) => {
	const hash = await eventFixtureWriteContract().write.logCombo([value, name]);
	return waitForWrite(hash);
};

export interface RecordingProvider extends LogsProvider {
	calls: GetLogsParams[];
}

// Wraps a real LogsProvider to record the params of every getLogs call it
// makes — a spy, not a mock: every call still goes out over the wire to the
// real chain, this just lets a test assert on the shape of the calls
// chunkedFetchLogs/detectRpcCapabilities actually issued.
export const recordCalls = (provider: LogsProvider): RecordingProvider => {
	const calls: GetLogsParams[] = [];
	return {
		calls,
		getBlockNumber: () => provider.getBlockNumber(),
		getLogs: async (params) => {
			calls.push(params);
			return provider.getLogs(params);
		},
	};
};
