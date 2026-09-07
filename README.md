# Ethereum Radio

[![npm](https://img.shields.io/npm/v/%40ethereum-radio%2Findexer)](https://www.npmjs.com/package/@ethereum-radio/indexer)

A browser-side event-log indexing library for dapps. `eth_getLogs` is treated
as a resumable, incremental data source instead of a one-shot query: point it
at any RPC (your own node, a public endpoint, or the connected wallet's own
provider) and it turns "find every matching log from deployment to tip" into
a stream your app can consume as it arrives, picks back up exactly where it
left off across reloads, and never re-does work it's already paid for.

It's a bet that a specific, common shape of dapp query — "the slice of
history reachable from what the caller already knows" (a thread, an address,
a floor block) rather than "all of it" — doesn't need a subgraph or a custom
backend, just a client-side library that remembers what it's already scanned.
See the [overview doc](https://polus-arcticus.github.io/ethereum-radio/docs/overview)
(or `docs/docs/overview.mdx` in this repo) for the full pitch, and the
[Try It page](https://polus-arcticus.github.io/ethereum-radio/try-it) for a live demo
against any contract/event on mainnet.

## Install

```bash
npm install @ethereum-radio/indexer
```

Peer dependencies (`viem`, `ethers`, `react`, `helia`) are all optional —
bring whichever adapter/framework you're actually using.

## Repository layout

This is a pnpm workspace. The only published package is `ethereum-radio/`;
everything else supports building, testing, or documenting it.

| Path              | What it is                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ethereum-radio/` | The library itself — published to npm as [`@ethereum-radio/indexer`](https://www.npmjs.com/package/@ethereum-radio/indexer). Core scan engine, viem/ethers adapters, storage backends, IPFS export/import, and a `/react` hook set. |
| `docs/`           | The Docusaurus site: concept overview, usage guide, API reference, and a live "Try It" demo widget backed by the published package.                            |
| `contracts/`      | Solidity fixtures used by `ethereum-radio`'s test suite (`EventFixture`, deployed to a real Anvil instance in CI/local tests) — inherited from a Hardhat+rocketh template, otherwise unused by the library. |
| `docker/`         | `rpc-limiter`, a small proxy used in tests to simulate an RPC provider that enforces a `getLogs` block-range cap, without needing a real rate-limited endpoint. |
| `web/`            | Reserved workspace slot for a future reference dapp — currently just the unmodified React Router starter scaffold.                                             |
| `proposals/`      | Write-ups of ideas from this project intended for upstream discussion elsewhere (e.g. `wighawag/etherfold`).                                                    |

## Development

```bash
pnpm install
```

- `pnpm indexer:test` — run the library's test suite (spins up a real Anvil
  instance via Docker; see `ethereum-radio/test/`).
- `pnpm indexer:typecheck` / `pnpm indexer:build` — typecheck / compile the
  library.
- `pnpm docs:start` — build the library, then start the docs site locally
  (includes the live Try It demo).
- `pnpm docs:build` — production build of the docs site.

## License

[Unlicense](LICENSE) — public domain.
