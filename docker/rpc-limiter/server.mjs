import {createServer} from 'node:http';

// A tiny JSON-RPC reverse proxy that enforces a block-range cap on
// eth_getLogs, mirroring the range limits real RPC providers impose (e.g.
// "eth_getLogs is limited to a X block range") — Anvil itself has no such
// limit, so this exists purely to give rpc-doctor/chunked-logs tests a real
// rejection to detect instead of a synthetic one.
const UPSTREAM_URL = process.env.UPSTREAM_URL ?? 'http://anvil:8545';
const MAX_LOG_RANGE = BigInt(process.env.MAX_LOG_RANGE ?? '50');
const PORT = Number(process.env.PORT ?? 8546);

const rangeTooWide = (body) => {
	if (body?.method !== 'eth_getLogs') return false;
	const filter = body.params?.[0];
	const fromBlock = filter?.fromBlock;
	const toBlock = filter?.toBlock;
	if (typeof fromBlock !== 'string' || typeof toBlock !== 'string') return false;
	if (!fromBlock.startsWith('0x') || !toBlock.startsWith('0x')) return false;
	const range = BigInt(toBlock) - BigInt(fromBlock);
	return range > MAX_LOG_RANGE;
};

const rangeError = (body) => ({
	jsonrpc: '2.0',
	id: body.id,
	error: {
		code: -32000,
		message: `Log response range too large. Requested range exceeds the ${MAX_LOG_RANGE} block limit for eth_getLogs.`,
	},
});

const server = createServer((req, res) => {
	const chunks = [];
	req.on('data', (chunk) => chunks.push(chunk));
	req.on('end', async () => {
		let body;
		try {
			body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		} catch {
			res.writeHead(400).end('invalid JSON');
			return;
		}

		if (!Array.isArray(body) && rangeTooWide(body)) {
			res.writeHead(200, {'content-type': 'application/json'});
			res.end(JSON.stringify(rangeError(body)));
			return;
		}

		try {
			const upstream = await fetch(UPSTREAM_URL, {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify(body),
			});
			const text = await upstream.text();
			res.writeHead(upstream.status, {'content-type': 'application/json'});
			res.end(text);
		} catch (err) {
			res.writeHead(502).end(`upstream error: ${err}`);
		}
	});
});

server.listen(PORT, () => {
	console.log(`rpc-limiter proxying ${UPSTREAM_URL} on :${PORT} (max eth_getLogs range: ${MAX_LOG_RANGE})`);
});
