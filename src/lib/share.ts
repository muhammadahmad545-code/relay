import RelayTransfer from '../../modules/relay-transfer';

export interface SharedPayload {
  text: string | null;
  files: { uri: string; name: string; mime: string; size: number }[];
  failed: string[];
}

let pending: SharedPayload | null = null;

/** Read what was shared to Relay (if anything) and keep it for the Send screen to pick up. */
export function collectShare(): SharedPayload | null {
  try {
    const items = RelayTransfer.takeSharedItems();
    if (items && (items.text || items.files.length > 0 || items.failed.length > 0)) {
      pending = items;
      return items;
    }
  } catch {
    // Older native build or no activity yet.
  }
  return null;
}

/** Hand the shared items to the Send screen exactly once. */
export function consumeShare(): SharedPayload | null {
  const items = pending;
  pending = null;
  return items;
}
