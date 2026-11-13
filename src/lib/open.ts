import * as IntentLauncher from 'expo-intent-launcher';

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** Open a received file with whatever app handles it. Returns false when nothing can. */
export async function openReceived(uri: string): Promise<boolean> {
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: uri, flags: FLAG_GRANT_READ_URI_PERMISSION });
    return true;
  } catch {
    return false;
  }
}
