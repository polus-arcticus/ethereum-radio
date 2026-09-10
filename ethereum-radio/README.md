# @ethereum-radio/indexer

Browser-side event-log indexing for dapps. `eth_getLogs` is treated as a
resumable, incremental data source instead of a one-shot query: point it at
any RPC (your own node, a public endpoint, or the connected wallet's own
provider) and it turns "find every matching log from deployment to tip" into
a stream your app can consume as it arrives, picks back up exactly where it
left off across reloads, and never re-does work it's already paid for.

Full docs, the concept overview, and a live demo: **https://polus-arcticus.github.io/ethereum-radio/**

## Install

```bash
npm install @ethereum-radio/indexer
```

Peer dependencies (`viem`, `ethers`, `react`, `helia`) are all optional —
bring whichever adapter/framework you're actually using.

## Quick example

Not every dapp needs a background process silently walking the entire chain.
If your UI only ever needs the slice of history it's currently showing — a
thread, a page, a "load more" click — `Cursor` lets you pull one window of
history on demand and stop there; nothing scans until you ask it to.

```ts
import {createPublicClient, custom} from 'viem';
import {mainnet} from 'viem/chains';
import {createViemAdapter} from '@ethereum-radio/indexer/adapters/viem';
import {createCursor, detectRpcCapabilities, safeBlockRangeLimit} from '@ethereum-radio/indexer';
import {createLocalStorageStore} from '@ethereum-radio/indexer/storage/local-storage';

// 1. Wrap a client you already constructed — routes through the connected
//    wallet's own RPC rather than a hardcoded endpoint.
const publicClient = createPublicClient({chain: mainnet, transport: custom(window.ethereum!)});
const provider = createViemAdapter(publicClient);

// 2. Probe the RPC instead of guessing a getLogs window width — public
//    endpoints commonly cap it as low as 5–10 blocks, and a width that
//    works today can still get rejected by a busier contract tomorrow.
const address = '0xYourContractAddress';
const {maxBlockRange} = await detectRpcCapabilities(provider, address, await publicClient.getBlockNumber());
const blockRangeLimit = maxBlockRange ? safeBlockRangeLimit(maxBlockRange) : 2_000n;

// 3. A Cursor never trusts in-memory state — it re-reads scan progress from
//    `store` on every call, so it's always safe to construct fresh and pick
//    up wherever the last one left off (a page reload, a different tab).
const cursor = createCursor({
	provider,
	store: createLocalStorageStore(),
	key: 'mainnet:0xYourContract:Transfer',
	address,
	floorBlock: 18_000_000n, // e.g. the contract's deployment block
	blockRangeLimit,
});

// 4. Pull one window of history on demand — call this again (e.g. on a
//    "load more" click) to keep walking backward toward floorBlock.
const logs = await cursor.fetchHistory();
```

Want a continuous stream instead — replay everything, then tail the live
tip — rather than pulling windows on demand? `createRadio` wraps the same
`Cursor` in a `for await` loop:

```ts
import {createRadio} from '@ethereum-radio/indexer';

const radio = createRadio({provider, store: createLocalStorageStore(), key: '...', address, floorBlock: 18_000_000n, blockRangeLimit});
for await (const logs of radio) {
	for (const log of logs) console.log(log.blockNumber, log.transactionHash);
}
```

See [Usage](https://polus-arcticus.github.io/ethereum-radio/docs/usage) for
the full walkthrough, and the
[API reference](https://polus-arcticus.github.io/ethereum-radio/docs/api/core)
for the complete surface (React hooks, storage backends, IPFS export/import,
reorg checking).

## License

Unlicense — public domain.
