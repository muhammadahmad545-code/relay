export interface Pairing {
  baseUrl: string;
  key: string;
  host: string;
}

const PRIVATE_V4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;

export function buildPairingUrl(address: string, port: number, key: string): string {
  return `http://${address}:${port}/#k=${key}`;
}

/**
 * Parse a scanned Relay QR code. Only private-network addresses are accepted, so a malicious
 * QR code cannot make the app send files to a server on the internet.
 */
export function parsePairing(data: string): Pairing | null {
  const match = /^http:\/\/([0-9.]+):(\d{1,5})\/?#k=([A-Za-z0-9_-]+)$/.exec(data.trim());
  if (!match) return null;
  const [, host, portText, key] = match;
  const port = Number(portText);
  if (!PRIVATE_V4.test(host) || host.split('.').some((part) => Number(part) > 255)) return null;
  if (port < 1 || port > 65535 || !KEY.test(key)) return null;
  return { baseUrl: `http://${host}:${port}`, key, host };
}

export interface LinkCode {
  id: string;
  publicKey: string;
}

/** Parse the code a laptop browser shows on the Relay page so the phone can link it. */
export function parseLinkCode(data: string): LinkCode | null {
  const match = /^relay-link:([A-Za-z0-9_-]{12}):([A-Za-z0-9_-]{87})$/.exec(data.trim());
  return match ? { id: match[1], publicKey: match[2] } : null;
}
