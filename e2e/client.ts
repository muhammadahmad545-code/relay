/**
 * End-to-end client: acts as a laptop browser against the phone's Relay server through an adb
 * port forward. Usage: tsx e2e/client.ts "<pairing url>" <local port> <file to upload>
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { RelayClient, decodeKey } from '../modules/relay-transfer/web/src/protocol';

async function main() {
  const [url, port, file] = process.argv.slice(2);
  const key = /#k=([A-Za-z0-9_-]+)/.exec(url)?.[1];
  if (!key) throw new Error(`no key in ${url}`);
  const client = new RelayClient(`http://127.0.0.1:${port}`, decodeKey(key));
  const hello = await client.hello();
  console.log('connected to', hello.name);
  const data = readFileSync(file);
  await client.upload({
    name: basename(file),
    size: data.length,
    type: 'application/octet-stream',
    read: async (offset, length) => new Uint8Array(data.subarray(offset, offset + length)),
  });
  console.log('uploaded', data.length, 'bytes');
  await client.sendText('hello from the laptop');
  console.log('text sent');
}

main().catch((error) => {
  console.error('CLIENT ERROR', error instanceof Error ? error.message : error);
  process.exit(1);
});
