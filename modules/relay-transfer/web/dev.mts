// Serves the built browser page from the reference server so the UI can be tried without a phone.
import { readFileSync } from 'node:fs';
import { startReferenceServer } from './reference-server.ts';

const html = readFileSync(new URL('../android/src/main/assets/relay-web/index.html', import.meta.url), 'utf8');
const ref = await startReferenceServer(html);
ref.outbox.push({ id: 'demo1', kind: 'file', name: 'holiday-photos.zip', mime: 'application/zip', data: Buffer.alloc(900_000, 7), text: null });
ref.outbox.push({ id: 'demo2', kind: 'text', name: 'Text', mime: 'text/plain', data: Buffer.alloc(0), text: 'https://example.com/a-link-from-the-phone' });
console.log(`Paired: ${ref.url}/#k=${ref.key.toString('base64url')}`);
console.log(`Unpaired (shows link code): ${ref.url}/`);
