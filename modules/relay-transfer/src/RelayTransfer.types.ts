export type TransferStatus = 'active' | 'done' | 'failed';

export interface TransferEvent {
  id: string;
  direction: 'in' | 'out';
  name: string;
  size: number;
  bytes: number;
  status: TransferStatus;
  error: string | null;
  savedUri: string | null;
}

export interface TextEvent {
  text: string;
  peer: string;
}

export interface PeerEvent {
  address: string;
}

export interface SessionInfo {
  port: number;
  addresses: string[];
  /** Base64url session key. Lives only in memory and in the QR code. */
  key: string;
}

export interface OutgoingFile {
  uri: string;
  name: string;
  mime: string;
}

export type RelayTransferModuleEvents = {
  onTransfer: (event: TransferEvent) => void;
  onText: (event: TextEvent) => void;
  onPeer: (event: PeerEvent) => void;
  onSessionEnded: (event: { reason: string }) => void;
};
