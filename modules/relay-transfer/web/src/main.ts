import qrcode from 'qrcode-generator';
import { RelayClient, RelayError, createLinkRequest, decodeKey, toBase64Url, waitForLink } from './protocol';
import type { OutboxItem } from './protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const statusText = $('status-text');
const deviceEl = $('device');
const appEl = $('app');
const fatalEl = $('fatal');
const dropEl = $('drop');
const pickEl = $<HTMLInputElement>('pick');
const sendList = $('send-list');
const inboxList = $('inbox-list');
const inboxEmpty = $('inbox-empty');
const textInput = $<HTMLTextAreaElement>('text');
const textButton = $<HTMLButtonElement>('text-send');

const UNITS = ['B', 'KB', 'MB', 'GB'];
function formatBytes(n: number): string {
  if (n <= 0) return '0 B';
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${UNITS[i]}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fatal(message: string) {
  appEl.hidden = true;
  fatalEl.hidden = false;
  $('fatal-text').textContent = message;
  setStatus('off', 'Not connected');
}

function setStatus(kind: 'on' | 'off' | 'wait', text: string) {
  statusEl.dataset.kind = kind;
  statusText.textContent = text;
}

interface Row {
  root: HTMLElement;
  bar: HTMLElement;
  meta: HTMLElement;
  action: HTMLButtonElement;
}

function makeRow(name: string, size: number): Row {
  const root = el('li', 'row');
  const top = el('div', 'row-top');
  const title = el('span', 'row-name', name);
  title.title = name;
  const action = el('button', 'link', 'Cancel');
  top.append(title, action);
  const track = el('div', 'track');
  const bar = el('div', 'bar');
  track.append(bar);
  const meta = el('div', 'row-meta', formatBytes(size));
  root.append(top, track, meta);
  return { root, bar, meta, action };
}

function qrSvg(text: string): SVGSVGElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 3;
  const size = count + quiet * 2;
  let path = '';
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Link code for the Relay app');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#fff');
  const fg = document.createElementNS(NS, 'path');
  fg.setAttribute('d', path);
  fg.setAttribute('fill', '#0B0D10');
  svg.append(bg, fg);
  return svg;
}

/** No key in the address: show a code for the phone to scan, then continue with the key it hands over. */
function link() {
  const request = createLinkRequest();
  $('link').hidden = false;
  $('link-qr').replaceChildren(qrSvg(request.code));
  setStatus('wait', 'Waiting for the phone');
  waitForLink(location.origin, request)
    .then((key) => {
      remember(toBase64Url(key));
      $('link').hidden = true;
      start();
    })
    .catch((error) => {
      $('link').hidden = true;
      fatal(error instanceof Error ? error.message : 'Linking failed.');
    });
}

const KEY_SLOT = 'relay-session-key';

/** Keep the key out of the address bar (and so out of browser history), but survive a reload. */
function remember(encoded: string) {
  try {
    sessionStorage.setItem(KEY_SLOT, encoded);
  } catch {
    // Private mode: the key stays only in memory for this page.
  }
  memoryKey = encoded;
  history.replaceState(null, '', location.pathname);
}

let memoryKey: string | null = null;

function recall(): string | null {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
  if (fromHash) {
    remember(fromHash);
    return fromHash;
  }
  if (memoryKey) return memoryKey;
  try {
    return sessionStorage.getItem(KEY_SLOT);
  } catch {
    return null;
  }
}

function forget() {
  memoryKey = null;
  try {
    sessionStorage.removeItem(KEY_SLOT);
  } catch {
    // Ignore.
  }
}

function start() {
  const encoded = recall();
  if (!encoded) return link();
  let client: RelayClient;
  try {
    client = new RelayClient(location.origin, decodeKey(encoded));
  } catch (error) {
    return fatal(error instanceof Error ? error.message : 'Invalid link.');
  }

  // ---- sending to the phone ----------------------------------------------------------------
  const queue: (() => Promise<void>)[] = [];
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    for (let job = queue.shift(); job; job = queue.shift()) await job();
    running = false;
  }

  function enqueue(file: File) {
    const row = makeRow(file.name, file.size);
    sendList.prepend(row.root);
    const controller = new AbortController();
    row.action.onclick = () => controller.abort();
    queue.push(async () => {
      if (controller.signal.aborted) {
        row.root.dataset.state = 'failed';
        row.meta.textContent = 'Cancelled';
        row.action.remove();
        return;
      }
      const startedAt = performance.now();
      try {
        await client.upload(
          { name: file.name, size: file.size, type: file.type, read: async (o, l) => new Uint8Array(await file.slice(o, o + l).arrayBuffer()) },
          {
            signal: controller.signal,
            onProgress: (bytes, total) => {
              row.bar.style.width = `${total ? (bytes / total) * 100 : 100}%`;
              const seconds = (performance.now() - startedAt) / 1000;
              row.meta.textContent = `${formatBytes(bytes)} of ${formatBytes(total)} · ${formatBytes(bytes / Math.max(seconds, 0.2))}/s`;
            },
          },
        );
        row.root.dataset.state = 'done';
        row.bar.style.width = '100%';
        row.meta.textContent = `Sent · ${formatBytes(file.size)} · saved to Downloads/Relay on the phone`;
      } catch (error) {
        row.root.dataset.state = 'failed';
        row.meta.textContent = error instanceof Error ? error.message : 'Failed';
      }
      row.action.remove();
    });
    void drain();
  }

  pickEl.onchange = () => {
    Array.from(pickEl.files ?? []).forEach(enqueue);
    pickEl.value = '';
  };
  dropEl.onclick = () => pickEl.click();
  dropEl.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickEl.click();
    }
  };
  for (const type of ['dragenter', 'dragover']) {
    dropEl.addEventListener(type, (e) => {
      e.preventDefault();
      dropEl.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropEl.addEventListener(type, (e) => {
      e.preventDefault();
      dropEl.classList.remove('over');
    });
  }
  dropEl.addEventListener('drop', (e) => Array.from(e.dataTransfer?.files ?? []).forEach(enqueue));
  window.addEventListener('paste', (e) => {
    if (document.activeElement === textInput) return;
    Array.from(e.clipboardData?.files ?? []).forEach(enqueue);
  });

  textButton.onclick = async () => {
    const text = textInput.value;
    if (!text.trim()) return;
    textButton.disabled = true;
    try {
      await client.sendText(text);
      textInput.value = '';
      textButton.textContent = 'Sent';
    } catch (error) {
      textButton.textContent = error instanceof RelayError ? 'Failed — retry' : 'Failed';
    }
    setTimeout(() => {
      textButton.textContent = 'Send text';
      textButton.disabled = false;
    }, 1500);
  };

  // ---- receiving from the phone ----------------------------------------------------------------
  const shown = new Map<string, HTMLElement>();

  function renderItem(item: OutboxItem): HTMLElement {
    if (item.kind === 'text') {
      const root = el('li', 'row');
      const body = el('pre', 'text-item', item.text ?? '');
      const copy = el('button', 'link', 'Copy');
      copy.onclick = () => {
        const done = () => {
          copy.textContent = 'Copied';
          setTimeout(() => (copy.textContent = 'Copy'), 1200);
        };
        // navigator.clipboard needs a secure context, which a LAN http page is not.
        const area = el('textarea');
        area.value = item.text ?? '';
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        try {
          document.execCommand('copy');
          done();
        } catch {
          copy.textContent = 'Select and copy manually';
        }
        area.remove();
      };
      root.append(body, copy);
      return root;
    }
    const row = makeRow(item.name, item.size);
    row.action.textContent = 'Download';
    let controller: AbortController | null = null;
    row.action.onclick = async () => {
      if (controller) return controller.abort();
      controller = new AbortController();
      row.action.textContent = 'Cancel';
      row.root.dataset.state = '';
      const progress = (bytes: number, total: number) => {
        row.bar.style.width = `${total ? (bytes / total) * 100 : 100}%`;
        row.meta.textContent = `${formatBytes(bytes)} of ${formatBytes(total)}`;
      };
      try {
        const picker = (window as unknown as { showSaveFilePicker?: (o: { suggestedName: string }) => Promise<{ createWritable: () => Promise<{ write: (d: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }> }> }).showSaveFilePicker;
        if (picker) {
          // Chrome and Edge: stream straight to disk, so even very large files use no extra memory.
          const handle = await picker({ suggestedName: item.name });
          const writable = await handle.createWritable();
          try {
            await client.download(item, { signal: controller.signal, onProgress: progress, onChunk: (c) => writable.write(c) });
            await writable.close();
          } catch (error) {
            await writable.abort().catch(() => {});
            throw error;
          }
        } else {
          if (item.size > 1.5 * 1024 ** 3 && !confirm(`This browser keeps downloads in memory until they finish. ${formatBytes(item.size)} may be too large. Continue?`)) {
            throw new RelayError('Cancelled.');
          }
          const chunks = await client.download(item, { signal: controller.signal, onProgress: progress });
          const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: item.mime || 'application/octet-stream' }));
          const anchor = el('a');
          anchor.href = url;
          anchor.download = item.name;
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
        void client.ack(item, true);
        row.root.dataset.state = 'done';
        row.meta.textContent = `Downloaded · ${formatBytes(item.size)}`;
      } catch (error) {
        const message = error instanceof Error && error.name === 'AbortError' ? 'Cancelled.' : error instanceof Error ? error.message : 'Failed';
        void client.ack(item, false, message);
        row.root.dataset.state = 'failed';
        row.bar.style.width = '0%';
        row.meta.textContent = message;
      }
      controller = null;
      row.action.textContent = 'Download';
    };
    return row.root;
  }

  let misses = 0;
  async function poll() {
    try {
      const items = await client.listOutbox();
      misses = 0;
      setStatus('on', 'Connected · encrypted');
      const ids = new Set(items.map((i) => i.id));
      for (const [id, node] of shown) {
        if (!ids.has(id)) {
          node.remove();
          shown.delete(id);
        }
      }
      for (const item of items) {
        if (!shown.has(item.id)) {
          const node = renderItem(item);
          shown.set(item.id, node);
          inboxList.prepend(node);
        }
      }
      inboxEmpty.hidden = shown.size > 0;
    } catch (error) {
      if (error instanceof RelayError && error.status === 401) {
        forget();
        return fatal('This session has ended. Open Relay on the phone and scan the new QR code.');
      }
      if (++misses >= 2) setStatus('wait', 'Phone not reachable — retrying');
    }
    setTimeout(poll, document.hidden ? 5000 : 1500);
  }

  setStatus('wait', 'Connecting…');
  client
    .hello()
    .then((info) => {
      deviceEl.textContent = `Connected to ${info.name}`;
      document.title = `Relay · ${info.name}`;
      appEl.hidden = false;
      void poll();
    })
    .catch((error) => fatal(error instanceof Error ? error.message : 'Could not connect.'));
}

start();
