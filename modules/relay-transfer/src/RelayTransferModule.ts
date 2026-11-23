import { NativeModule, requireNativeModule } from 'expo';

import type { OutgoingFile, RelayTransferModuleEvents, SessionInfo } from './RelayTransfer.types';

declare class RelayTransferModule extends NativeModule<RelayTransferModuleEvents> {
  readonly chunkBytes: number;
  getLocalAddresses(): string[];
  isRunning(): boolean;
  start(deviceName: string): Promise<SessionInfo>;
  stop(): void;
  shareFile(file: OutgoingFile): string;
  shareText(text: string): string;
  linkBrowser(id: string, publicKey: string): void;
  unshare(id: string): void;
  clearShared(): void;
  connect(baseUrl: string, key: string): Promise<string>;
  sendFiles(baseUrl: string, key: string, files: OutgoingFile[]): Promise<{ sent: number; failed: number }>;
  sendText(baseUrl: string, key: string, text: string): Promise<void>;
  cancelSend(): void;
  /** Hide the app from screenshots and the recent-apps preview. */
  setSecure(on: boolean): void;
  /** Open Android's share sheet for a received file. */
  shareReceived(uri: string, mime: string): void;
  /** Delete a received file; true when it is gone. */
  deleteReceived(uri: string): boolean;
  /** Whether a received file still exists on the phone. */
  receivedExists(uri: string): boolean;
  /** Add Receive and Send to the launcher icon's long-press menu. */
  installShortcuts(): boolean;
  /** Text and files shared to Relay from another app, once per share; null when there is none. */
  takeSharedItems(): { text: string | null; files: { uri: string; name: string; mime: string; size: number }[]; failed: string[] } | null;
}

export default requireNativeModule<RelayTransferModule>('RelayTransfer');
