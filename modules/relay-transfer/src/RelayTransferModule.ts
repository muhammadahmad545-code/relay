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
}

export default requireNativeModule<RelayTransferModule>('RelayTransfer');
