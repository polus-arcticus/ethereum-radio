import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function TryIt(): ReactNode {
	return (
		<Layout
			title="Try it out"
			description="Connect a wallet and stream real event logs with @ethereum-radio/indexer">
			<main className="container margin-vert--lg">
				<h1>Try it out</h1>
				<p>
					Connect an injected wallet (MetaMask or similar), point it at a
					contract, and watch <code>createRadio</code> stream matching event
					logs live — using the real package, against whatever chain your
					wallet is connected to.
				</p>
				{/* Wallet/RPC access only exists in the browser — this must never
				    run during Docusaurus's static build/SSR pass. */}
				<BrowserOnly fallback={<p>Loading…</p>}>
					{() => {
						const TryItWidget = require('@site/src/components/TryItWidget').default;
						return <TryItWidget />;
					}}
				</BrowserOnly>
			</main>
		</Layout>
	);
}
