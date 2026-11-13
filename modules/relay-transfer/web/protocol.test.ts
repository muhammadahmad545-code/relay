import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { CHUNK, nodeOpen, nodeSeal, nodeToken, startReferenceServer } from './reference-server';
import type { ReferenceServer } from './reference-server';
import { RelayClient, RelayError, createLinkRequest, decodeKey, deriveToken, open, seal, waitForLink } from './src/protocol';

let ref: ReferenceServer;
let client: RelayClient;

const sourceOf = (name: string, data: Buffer) => ({
  name,
  size: data.length,
  type: 'application/octet-stream',
  read: async (offset: number, length: number) => new Uint8Array(data.subarray(offset, offset + length)),
});

before(async () => {
  ref = await startReferenceServer();
  client = new RelayClient(ref.url, new Uint8Array(ref.key));
});
after(() => ref.close());

test('bundled AES-GCM interoperates with OpenSSL in both directions', () => {
  const key = randomBytes(32);
  const plain = randomBytes(1000);
  assert.deepEqual(Buffer.from(open(new Uint8Array(key), 'ctx', new Uint8Array(nodeSeal(key, 'ctx', plain)))), plain);
  assert.deepEqual(nodeOpen(key, 'ctx', Buffer.from(seal(new Uint8Array(key), 'ctx', new Uint8Array(plain)))), plain);
});

test('a message sealed for one purpose cannot be opened as another', () => {
  const key = new Uint8Array(randomBytes(32));
  const sealed = seal(key, 'chunk:a:0', new Uint8Array([1, 2, 3]));
  assert.throws(() => open(key, 'chunk:a:1', sealed), RelayError);
});

test('token derivation matches the server and the key codec round-trips', () => {
  assert.equal(deriveToken(new Uint8Array(ref.key)), nodeToken(ref.key));
  assert.deepEqual(Buffer.from(decodeKey(ref.key.toString('base64url'))), ref.key);
  assert.throws(() => decodeKey('too-short'), RelayError);
});

test('hello succeeds with the right key and fails with a wrong one', async () => {
  assert.equal((await client.hello()).name, 'Reference');
  const stranger = new RelayClient(ref.url, new Uint8Array(randomBytes(32)));
  await assert.rejects(stranger.hello(), (e: unknown) => e instanceof RelayError && e.status === 401);
});

test('multi-chunk upload arrives byte-identical', async () => {
  const data = randomBytes(CHUNK * 2 + 12345);
  const progress: number[] = [];
  await client.upload(sourceOf('photo.bin', data), { onProgress: (b) => progress.push(b) });
  const saved = [...ref.received.values()].find((f) => f.name === 'photo.bin');
  assert.ok(saved && saved.data.equals(data));
  assert.equal(progress.at(-1), data.length);
});

test('empty file uploads cleanly', async () => {
  await client.upload(sourceOf('empty.txt', Buffer.alloc(0)));
  assert.ok([...ref.received.values()].some((f) => f.name === 'empty.txt' && f.data.length === 0));
});

test('upload resumes without duplicating data when the connection drops mid-transfer', async () => {
  const data = randomBytes(CHUNK * 3 + 7);
  ref.dropAfterStore = 2;
  await client.upload(sourceOf('resume.bin', data));
  const saved = [...ref.received.values()].find((f) => f.name === 'resume.bin');
  assert.ok(saved && saved.data.equals(data));
});

test('download reassembles a shared file and text is delivered', async () => {
  const data = randomBytes(CHUNK + 999);
  ref.outbox.push({ id: 'f1', kind: 'file', name: 'doc.pdf', mime: 'application/pdf', data, text: null });
  const [item] = await client.listOutbox();
  const chunks = await client.download(item);
  assert.ok(Buffer.concat(chunks).equals(data));
  await client.sendText('héllo 👋');
  assert.deepEqual(ref.texts, ['héllo 👋']);
});

test('cancelling stops an upload', async () => {
  const controller = new AbortController();
  const data = randomBytes(CHUNK * 4);
  const pending = client.upload(sourceOf('cancel.bin', data), { signal: controller.signal, onProgress: () => controller.abort() });
  await assert.rejects(pending, RelayError);
  assert.ok(![...ref.received.values()].some((f) => f.name === 'cancel.bin'));
});

test('a browser linked by QR scan receives the session key, and can collect it again if a response was lost', async () => {
  const request = createLinkRequest();
  const pending = waitForLink(ref.url, request);
  ref.link(request.code);
  assert.deepEqual(Buffer.from(await pending), ref.key);
  assert.equal((await fetch(`${ref.url}/pair/${request.id}`)).status, 200);
});

test('linking gives up with a clear message instead of waiting forever', async () => {
  await assert.rejects(waitForLink(ref.url, createLinkRequest(), undefined, 1500), /did not link in time/);
});

test('a captured request cannot be replayed', async () => {
  const body = seal(new Uint8Array(ref.key), 'text', new TextEncoder().encode(JSON.stringify({ text: 'once' })));
  const send = () => fetch(`${ref.url}/api/text`, { method: 'POST', headers: { 'X-Relay-Token': deriveToken(new Uint8Array(ref.key)) }, body: body as BodyInit });
  assert.equal((await send()).status, 200);
  const replay = await send();
  assert.equal(replay.status, 400);
  assert.match((await replay.json()).error, /already used/);
});

test('downloads can stream chunk by chunk and are acknowledged to the phone', async () => {
  const data = randomBytes(CHUNK * 2 + 10);
  ref.outbox.push({ id: 'f2', kind: 'file', name: 'video.mp4', mime: 'video/mp4', data, text: null });
  const item = (await client.listOutbox()).find((i) => i.id === 'f2')!;
  const parts: Buffer[] = [];
  const kept = await client.download(item, { onChunk: async (c) => void parts.push(Buffer.from(c)) });
  assert.equal(kept.length, 0);
  assert.ok(Buffer.concat(parts).equals(data));
  await client.ack(item, true);
  assert.deepEqual(ref.acks.at(-1), { id: 'f2', ok: true, error: '' });
});

test('a different browser cannot unwrap a key linked to someone else', async () => {
  const victim = createLinkRequest();
  const attacker = createLinkRequest();
  ref.link(victim.code);
  // The attacker fetches the victim's wrapped key but holds a different private key.
  await assert.rejects(waitForLink(ref.url, { ...attacker, id: victim.id }), RelayError);
});
