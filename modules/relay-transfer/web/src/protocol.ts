/**
 * Relay wire protocol, client side. Runs in the browser page the phone serves and in Node (tests).
 *
 * Every payload is AES-256-GCM: nonce (12) || ciphertext || tag (16). The key arrives in the URL
 * fragment from the QR code, so it is never sent over the network. WebCrypto is unavailable on
 * plain-http LAN origins, which is why a pure-JS implementation is bundled.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class RelayError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'RelayError';
    this.status = status;
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(encoded: string): Uint8Array {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ---- linking a browser without typing a key -------------------------------------------------
//
// The browser shows its ECDH public key as a QR code. The phone scans it (so the public key
// arrives over the camera, not the network), does P-256 ECDH and leaves the session key wrapped
// for that browser to pick up. An eavesdropper on the network sees only public values.

export interface LinkRequest {
  id: string;
  secret: Uint8Array;
  /** Text encoded in the QR code the phone scans. */
  code: string;
}

export function createLinkRequest(): LinkRequest {
  const secret = p256.utils.randomSecretKey();
  const id = toBase64Url(crypto.getRandomValues(new Uint8Array(9)));
  return { id, secret, code: `relay-link:${id}:${toBase64Url(p256.getPublicKey(secret, false))}` };
}

export function deriveLinkKey(sharedX: Uint8Array, id: string): Uint8Array {
  const prefix = encoder.encode('relay-link-v1');
  const suffix = encoder.encode(id);
  const input = new Uint8Array(prefix.length + sharedX.length + suffix.length);
  input.set(prefix);
  input.set(sharedX, prefix.length);
  input.set(suffix, prefix.length + sharedX.length);
  return sha256(input);
}

/** Unwrap the session key the phone left for this browser. */
export function completeLink(request: LinkRequest, phonePublicKey: string, sealedKey: string): Uint8Array {
  let key: Uint8Array;
  try {
    const shared = p256.getSharedSecret(request.secret, fromBase64Url(phonePublicKey), true).subarray(1);
    key = open(deriveLinkKey(shared, request.id), `link:${request.id}`, fromBase64Url(sealedKey));
  } catch {
    throw new RelayError('Linking failed. Reload this page and scan again.');
  }
  if (key.length !== 32) throw new RelayError('Linking failed. Reload this page and scan again.');
  return key;
}

/** Poll until the phone has scanned the code. Resolves with the session key; gives up after `timeoutMs`. */
export async function waitForLink(baseUrl: string, request: LinkRequest, signal?: AbortSignal, timeoutMs = 3 * 60 * 1000): Promise<Uint8Array> {
  const base = baseUrl.replace(/\/+$/, '');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new RelayError('Cancelled.');
    if (Date.now() > deadline) throw new RelayError('The phone did not link in time. Reload this page to get a new code.');
    try {
      const response = await fetch(`${base}/pair/${request.id}`, { cache: 'no-store', signal });
      if (response.ok) {
        const body = (await response.json()) as { pub: string; sealed: string };
        return completeLink(request, body.pub, body.sealed);
      }
    } catch (error) {
      if (error instanceof RelayError) throw error;
      // Phone briefly unreachable: keep waiting.
    }
    await sleep(1000);
  }
}

export function decodeKey(encoded: string): Uint8Array {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    throw new RelayError('This link is incomplete. Scan the QR code again.');
  }
  const key = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (key.length !== 32) throw new RelayError('This link is incomplete. Scan the QR code again.');
  return key;
}

export function deriveToken(key: Uint8Array): string {
  const prefix = encoder.encode('relay-auth-v1');
  const input = new Uint8Array(prefix.length + key.length);
  input.set(prefix);
  input.set(key, prefix.length);
  return Array.from(sha256(input).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function seal(key: Uint8Array, aad: string, plain: Uint8Array): Uint8Array {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = gcm(key, nonce, encoder.encode(aad)).encrypt(plain);
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(nonce);
  out.set(sealed, NONCE_BYTES);
  return out;
}

export function open(key: Uint8Array, aad: string, sealed: Uint8Array): Uint8Array {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) throw new RelayError('Encrypted message is too short.');
  try {
    return gcm(key, sealed.subarray(0, NONCE_BYTES), encoder.encode(aad)).decrypt(sealed.subarray(NONCE_BYTES));
  } catch {
    throw new RelayError('Decryption failed. Scan the QR code again.');
  }
}

export interface OutboxItem {
  id: string;
  kind: 'file' | 'text';
  name: string;
  mime: string;
  size: number;
  totalChunks: number;
  text: string | null;
}

export interface UploadSource {
  name: string;
  size: number;
  type: string;
  /** Read `length` bytes starting at `offset`. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface TransferControl {
  onProgress?: (bytes: number, total: number) => void;
  signal?: AbortSignal;
}

const MAX_RETRIES = 5;

export class RelayClient {
  private readonly base: string;
  private readonly key: Uint8Array;
  private readonly token: string;
  chunkBytes = 512 * 1024;

  constructor(baseUrl: string, key: Uint8Array) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.key = key;
    this.token = deriveToken(key);
  }

  private async request(method: string, path: string, body?: Uint8Array, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.base + path, {
        method,
        headers: body ? { 'X-Relay-Token': this.token, 'Content-Type': 'application/octet-stream' } : { 'X-Relay-Token': this.token },
        body: body as BodyInit | undefined,
        signal,
        cache: 'no-store',
      });
    } catch (cause) {
      if (signal?.aborted) throw new RelayError('Cancelled.');
      throw new RelayError('Cannot reach the phone. Keep Relay open and stay on the same network.');
    }
    return response;
  }

  private async fail(response: Response, fallback: string): Promise<never> {
    let message = fallback;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the fallback.
    }
    throw new RelayError(message, response.status);
  }

  private async sealedJson<T>(response: Response, aad: string): Promise<T> {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return JSON.parse(decoder.decode(open(this.key, aad, bytes))) as T;
  }

  async hello(): Promise<{ name: string; protocol: number; chunkBytes: number }> {
    const response = await this.request('GET', '/api/hello');
    if (!response.ok) await this.fail(response, 'The phone refused the connection.');
    const info = await this.sealedJson<{ name: string; protocol: number; chunkBytes: number }>(response, 'hello');
    if (info.chunkBytes > 0) this.chunkBytes = info.chunkBytes;
    return info;
  }

  async sendText(text: string): Promise<void> {
    const body = seal(this.key, 'text', encoder.encode(JSON.stringify({ text })));
    const response = await this.request('POST', '/api/text', body);
    if (!response.ok) await this.fail(response, 'The phone did not accept the text.');
  }

  async listOutbox(signal?: AbortSignal): Promise<OutboxItem[]> {
    const response = await this.request('GET', '/api/outbox', undefined, signal);
    if (!response.ok) await this.fail(response, 'Could not read what the phone is sharing.');
    return (await this.sealedJson<{ items: OutboxItem[] }>(response, 'outbox')).items;
  }

  /** Upload one file to the phone in encrypted chunks, resuming after dropped connections. */
  async upload(source: UploadSource, control: TransferControl = {}): Promise<void> {
    const { onProgress, signal } = control;
    const meta = seal(this.key, 'meta', encoder.encode(JSON.stringify({ name: source.name, size: source.size, mime: source.type })));
    const created = await this.request('POST', '/api/transfers', meta, signal);
    if (!created.ok) await this.fail(created, 'The phone refused the file.');
    const { id } = await this.sealedJson<{ id: string }>(created, 'meta-res');

    const chunk = this.chunkBytes;
    const totalChunks = Math.ceil(source.size / chunk);
    try {
      let index = 0;
      let attempts = 0;
      while (index < totalChunks) {
        if (signal?.aborted) throw new RelayError('Cancelled.');
        const offset = index * chunk;
        const plain = await source.read(offset, Math.min(chunk, source.size - offset));
        const sealed = seal(this.key, `chunk:${id}:${index}`, plain);
        let response: Response;
        try {
          response = await this.request('PUT', `/api/transfers/${id}/chunks/${index}`, sealed, signal);
        } catch (error) {
          if (signal?.aborted || ++attempts > MAX_RETRIES) throw error;
          await sleep(400 * attempts * attempts);
          index = (await this.resumeIndex(id)) ?? index;
          continue;
        }
        if (response.ok) {
          index++;
          attempts = 0;
          onProgress?.(Math.min(source.size, index * chunk), source.size);
        } else if (response.status === 409) {
          const body = (await response.json().catch(() => ({}))) as { next?: number };
          if (typeof body.next !== 'number') throw new RelayError('The transfer went out of sync.', 409);
          index = body.next;
        } else {
          await this.fail(response, 'The phone rejected the data.');
        }
      }
      const done = await this.request('POST', `/api/transfers/${id}/complete`, seal(this.key, `complete:${id}`, encoder.encode('{}')), signal);
      if (!done.ok) await this.fail(done, 'The phone could not save the file.');
      onProgress?.(source.size, source.size);
    } catch (error) {
      this.request('POST', `/api/transfers/${id}/cancel`, seal(this.key, `cancel:${id}`, encoder.encode('{}'))).catch(() => {});
      throw error;
    }
  }

  private async resumeIndex(id: string): Promise<number | null> {
    try {
      const response = await this.request('GET', `/api/transfers/${id}`);
      if (!response.ok) return null;
      const body = (await response.json()) as { next?: number };
      return typeof body.next === 'number' ? body.next : null;
    } catch {
      return null;
    }
  }

  /** Tell the phone how a download ended, so its progress row finishes correctly. */
  async ack(item: OutboxItem, ok: boolean, error?: string): Promise<void> {
    const body = seal(this.key, `ack:${item.id}`, encoder.encode(JSON.stringify({ ok, error: error ?? '' })));
    await this.request('POST', `/api/outbox/${item.id}/ack`, body).catch(() => {});
  }

  /**
   * Download a file the phone is sharing. With `onChunk`, each decrypted chunk is handed over as it
   * arrives (stream to disk) and nothing is kept in memory; otherwise the chunks are returned.
   */
  async download(item: OutboxItem, control: TransferControl & { onChunk?: (chunk: Uint8Array) => Promise<void> } = {}): Promise<Uint8Array[]> {
    const { onProgress, signal, onChunk } = control;
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (let index = 0; index < item.totalChunks; index++) {
      let attempts = 0;
      for (;;) {
        if (signal?.aborted) throw new RelayError('Cancelled.');
        try {
          const response = await this.request('GET', `/api/outbox/${item.id}/chunks/${index}`, undefined, signal);
          if (!response.ok) await this.fail(response, 'The phone stopped sharing this file.');
          const plain = open(this.key, `out:${item.id}:${index}`, new Uint8Array(await response.arrayBuffer()));
          if (onChunk) await onChunk(plain);
          else chunks.push(plain);
          received += plain.length;
          onProgress?.(received, item.size);
          break;
        } catch (error) {
          const retryable = error instanceof RelayError && error.status === 0 && !signal?.aborted;
          if (!retryable || ++attempts > MAX_RETRIES) throw error;
          await sleep(400 * attempts * attempts);
        }
      }
    }
    if (received !== item.size) throw new RelayError('The download was incomplete.');
    return chunks;
  }
}
