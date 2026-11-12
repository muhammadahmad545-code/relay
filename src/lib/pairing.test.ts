import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPairingUrl, parseLinkCode, parsePairing } from './pairing';

const key = 'A'.repeat(43);

test('round-trips a pairing URL', () => {
  const parsed = parsePairing(buildPairingUrl('192.168.1.20', 8765, key));
  assert.deepEqual(parsed, { baseUrl: 'http://192.168.1.20:8765', key, host: '192.168.1.20' });
});

test('accepts all private ranges, including hotspot addresses', () => {
  for (const host of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.43.1']) {
    assert.ok(parsePairing(`http://${host}:8765/#k=${key}`), host);
  }
});

test('rejects public hosts, hostnames, https and malformed keys', () => {
  for (const bad of [
    `http://8.8.8.8:8765/#k=${key}`,
    `http://172.32.0.1:8765/#k=${key}`,
    `http://evil.example:8765/#k=${key}`,
    `https://192.168.1.20:8765/#k=${key}`,
    `http://192.168.1.999:8765/#k=${key}`,
    `http://192.168.1.20:99999/#k=${key}`,
    `http://192.168.1.20:8765/#k=short`,
    `http://192.168.1.20:8765/`,
    'WIFI:S:home;T:WPA;P:secret;;',
  ]) {
    assert.equal(parsePairing(bad), null, bad);
  }
});

test('parses a browser link code and rejects look-alikes', () => {
  const code = `relay-link:${'a'.repeat(12)}:${'B'.repeat(87)}`;
  assert.deepEqual(parseLinkCode(code), { id: 'a'.repeat(12), publicKey: 'B'.repeat(87) });
  assert.equal(parseLinkCode(`relay-link:${'a'.repeat(12)}:${'B'.repeat(86)}`), null);
  assert.equal(parseLinkCode(`http://192.168.1.2:8765/#k=${key}`), null);
});
