/**
 * Measures what a connection to LINE costs, with and without connection reuse.
 *
 * "cold" opens a fresh TCP + TLS connection per request, which is what Node's
 * default fetch does once a socket has been idle past its 4s keep-alive window
 * -- i.e. what a bot replying to sporadic messages was paying on every send.
 * "warm" reuses the pooled connection the adapter now keeps open.
 *
 * Usage: node apps/bot-worker/bench/network-costs.mjs
 */
import { Agent, fetch as undiciFetch } from "undici";

const ENDPOINT = process.env.LINE_ENDPOINT ?? "https://legy.line-apps.com/";
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 8);

async function timeRequest(dispatcher) {
	const startedAt = performance.now();
	try {
		const response = await undiciFetch(ENDPOINT, { method: "GET", dispatcher });
		await response.arrayBuffer();
	} catch (error) {
		// A 4xx/5xx from LINE is fine -- we are timing the transport, not the
		// endpoint's opinion of an unauthenticated GET.
		if (error?.cause?.code) throw error;
	}
	return performance.now() - startedAt;
}

function report(label, samples) {
	samples.sort((a, b) => a - b);
	const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	console.log(
		`${label.padEnd(34)} mean ${mean.toFixed(1).padStart(7)} ms   ` +
		`min ${samples[0].toFixed(1).padStart(7)} ms   max ${samples.at(-1).toFixed(1).padStart(7)} ms`,
	);
	return mean;
}

console.log(`\n=== Transport cost to ${ENDPOINT} (${ROUNDS} requests each) ===`);

const cold = [];
for (let round = 0; round < ROUNDS; round++) {
	const dispatcher = new Agent({ keepAliveTimeout: 1, connections: 1 });
	cold.push(await timeRequest(dispatcher));
	await dispatcher.close();
}
const coldMean = report("cold (new connection each time)", cold);

const warmDispatcher = new Agent({ keepAliveTimeout: 120_000, keepAliveMaxTimeout: 120_000, connections: 8 });
await timeRequest(warmDispatcher); // establish the pooled connection
const warm = [];
for (let round = 0; round < ROUNDS; round++) warm.push(await timeRequest(warmDispatcher));
const warmMean = report("warm (pooled, kept alive)", warm);
await warmDispatcher.close();

console.log(`\nSaved per request by keeping the connection open: ${(coldMean - warmMean).toFixed(1)} ms`);
