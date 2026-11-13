import { File, Paths } from 'expo-file-system';

/**
 * The document picker copies picked files into the app cache. Remove those copies once they are
 * sent or no longer shared, so a 4 GB video does not keep using 4 GB.
 */
export function deletePickedCopies(uris: string[]): void {
  const cache = Paths.cache.uri;
  for (const uri of uris) {
    if (!uri.startsWith(cache)) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Best effort.
    }
  }
}
