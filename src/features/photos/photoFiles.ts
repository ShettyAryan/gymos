import { Directory, File, Paths } from 'expo-file-system';

import { newId } from '@/utils/id';

/** Photos live in the app's private document directory (not the shared gallery). */
function photoDir(): Directory {
  const dir = new Directory(Paths.document, 'progress-photos');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Copies a picked/captured image into private storage and returns the new file URI. */
export function importPhoto(sourceUri: string): string {
  const dest = new File(photoDir(), `${newId()}.jpg`);
  new File(sourceUri).copy(dest);
  return dest.uri;
}

export function deletePhotoFile(uri: string | null): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Missing file is fine; never throw from cleanup.
  }
}

export async function readPhotoBytes(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

export function photoExists(uri: string | null): boolean {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/** Downloads a private photo (via a short-lived signed URL) into private storage. */
export async function downloadPhoto(signedUrl: string): Promise<string> {
  const dest = new File(photoDir(), `${newId()}.jpg`);
  const file = await File.downloadFileAsync(signedUrl, dest);
  return file.uri;
}
