import {createConfig} from 'wagmi';
import {mainnet, sepolia} from 'wagmi/chains';
import {injected, unstable_connector} from '@wagmi/core';

// Injected wallets only (no WalletConnect/QR) — mirrors
// ~/code/hashchan/web/src/config.ts. unstable_connector(injected) is a
// Transport that routes every RPC call, read or write, through whichever
// injected connector is currently active, instead of a separate JSON-RPC
// URL — so usePublicClient() (what createViemAdapter needs) goes through
// the connected wallet's own provider. Multi-wallet discovery (EIP-6963)
// and eth_requestAccounts are handled by wagmi's createConfig/injected
// connector by default — nothing custom needed here.
export const wagmiConfig = createConfig({
	chains: [mainnet, sepolia],
	transports: {
		[mainnet.id]: unstable_connector(injected),
		[sepolia.id]: unstable_connector(injected),
	},
});
