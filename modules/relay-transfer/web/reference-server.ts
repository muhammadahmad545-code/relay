/**
 * Test-only reference implementation of the phone's server (the real one is RelayServer.kt).
 * It uses Node's OpenSSL AES-GCM, so the tests prove the bundled pure-JS client interoperates
 * with a standard implementation — the same standard Android's javax.crypto follows.
 */
import { createCipheriv, createDecipheriv, createECDH, createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export const CHUNK = 512 * 1024;

export function nodeSeal(key: Buffer, aad: string, plain: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  return Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

export function nodeOpen(key: Buffer, aad: string, sealed: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
}

export const nodeToken = (key: Buffer) =>
  createHash('sha256').update('relay-auth-v1').update(key).digest('hex').slice(0, 32);

interface Incoming {
  name: string;
  size: number;
  parts: Buffer[];
  next: number;
  received: number;
}

export interface ReferenceServer {
  server: Server;
  url: string;
  key: Buffer;
  received: Map<string, { name: string; data: Buffer }>;
  texts: string[];
  outbox: { id: string; kind: 'file' | 'text'; name: string; mime: string; data: Buffer; text: string | null }[];
  /** Make the next N chunk uploads drop the connection after the data was stored. */
  dropAfterStore: number;
  /** What the phone does after scanning a browser's link code. Mirrors RelayCrypto.linkResponse. */
  link(code: string): void;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export async function startReferenceServer(html?: string): Promise<ReferenceServer> {
  const key = randomBytes(32);
  const token = nodeToken(key);
  const incoming = new Map<string, Incoming>();
  const pairings = new Map<string, { pub: string; sealed: string }>();
  const state: ReferenceServer = {
    server: undefined as unknown as Server,
    url: '',
    key,
    received: new Map(),
    texts: [],
    outbox: [],
    dropAfterStore: 0,
    link: (code: string) => {
      const [, id, pub] = /^relay-link:([A-Za-z0-9_-]{12}):([A-Za-z0-9_-]{87})$/.exec(code) ?? [];
      if (!id) throw new Error('bad link code');
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      const shared = ecdh.computeSecret(Buffer.from(pub, 'base64url'));
      const wrap = createHash('sha256').update('relay-link-v1').update(shared).update(id).digest();
      pairings.set(id, { pub: ecdh.getPublicKey().toString('base64url'), sealed: nodeSeal(wrap, `link:${id}`, key).toString('base64url') });
    },
    close: () => new Promise((r) => state.server.close(() => r())),
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const sealed = (res: ServerResponse, aad: string, body: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(nodeSeal(key, aad, Buffer.from(JSON.stringify(body))));
  };

  state.server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '/').replace(/\/+$/, '');
      const body = await readBody(req);
      if (html && req.method === 'GET' && path === '') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (req.method === 'GET' && path.startsWith('/pair/')) {
        const pairing = pairings.get(path.slice(6));
        if (!pairing) return json(res, 404, { error: 'Not linked yet.' });
        pairings.delete(path.slice(6));
        return json(res, 200, pairing);
      }
      if (!path.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
      if (req.headers['x-relay-token'] !== token) return json(res, 401, { error: 'This link is no longer valid. Scan the QR code again.' });
      const parts = path.slice(5).split('/');
      const m = req.method;

      if (m === 'GET' && path === '/api/hello') return sealed(res, 'hello', { name: 'Reference', protocol: 1, chunkBytes: CHUNK });
      if (m === 'POST' && path === '/api/text') {
        state.texts.push(JSON.parse(nodeOpen(key, 'text', body).toString()).text);
        return json(res, 200, { ok: true });
      }
      if (m === 'POST' && path === '/api/transfers') {
        const meta = JSON.parse(nodeOpen(key, 'meta', body).toString());
        const id = randomBytes(9).toString('base64url');
        incoming.set(id, { name: meta.name, size: meta.size, parts: [], next: 0, received: 0 });
        return sealed(res, 'meta-res', { id, chunkBytes: CHUNK });
      }
      if (parts[0] === 'transfers' && parts.length >= 2) {
        const id = parts[1];
        const t = incoming.get(id);
        if (!t) return json(res, 404, { error: 'Transfer not found.' });
        if (m === 'GET' && parts.length === 2) return json(res, 200, { next: t.next });
        if (m === 'PUT' && parts[2] === 'chunks') {
          const index = Number(parts[3]);
          if (index !== t.next) return json(res, 409, { error: 'Out of order chunk.', next: t.next });
          const plain = nodeOpen(key, `chunk:${id}:${index}`, body);
          if (t.received + plain.length > t.size) return json(res, 400, { error: 'More data than announced.' });
          t.parts.push(plain);
          t.received += plain.length;
          t.next = index + 1;
          if (state.dropAfterStore > 0) {
            state.dropAfterStore--;
            return req.socket.destroy();
          }
          return json(res, 200, { next: t.next });
        }
        if (m === 'POST' && parts[2] === 'complete') {
          if (t.received !== t.size) return json(res, 409, { error: 'Transfer is incomplete.', next: t.next });
          state.received.set(id, { name: t.name, data: Buffer.concat(t.parts) });
          incoming.delete(id);
          return json(res, 200, { ok: true });
        }
        if (m === 'POST' && parts[2] === 'cancel') {
          incoming.delete(id);
          return json(res, 200, { ok: true });
        }
      }
      if (m === 'GET' && path === '/api/outbox') {
        return sealed(res, 'outbox', {
          items: state.outbox.map((o) => ({ id: o.id, kind: o.kind, name: o.name, mime: o.mime, size: o.data.length, totalChunks: Math.ceil(o.data.length / CHUNK), text: o.text })),
        });
      }
      if (m === 'GET' && parts[0] === 'outbox' && parts[2] === 'chunks') {
        const item = state.outbox.find((o) => o.id === parts[1]);
        if (!item) return json(res, 404, { error: 'This item is no longer shared.' });
        const index = Number(parts[3]);
        const slice = item.data.subarray(index * CHUNK, Math.min(item.data.length, (index + 1) * CHUNK));
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return res.end(nodeSeal(key, `out:${item.id}:${index}`, slice));
      }
      return json(res, 404, { error: 'Not found.' });
    } catch {
      return json(res, 400, { error: 'Decryption failed. Scan the QR code again.' });
    }
  });
  await new Promise<void>((r) => state.server.listen(0, '127.0.0.1', r));
  const address = state.server.address();
  if (typeof address === 'object' && address) state.url = `http://127.0.0.1:${address.port}`;
  return state;
}
