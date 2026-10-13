import { Upload } from 'tus-js-client';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from './supabase';

/**
 * Resumable (TUS) upload to Supabase Storage. Supabase requires 6 MB chunks.
 * Fingerprints are stored in localStorage, so a page reload / dropped connection
 * resumes from the last chunk when the same file is re-selected.
 */
export async function uploadResumable(path: string, file: Blob, contentType: string, onProgress: (frac: number) => void): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const isHosted = SUPABASE_URL.includes('.supabase.co');
  const endpoint = isHosted
    ? `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
    : `${SUPABASE_URL}/storage/v1/upload/resumable`;

  await new Promise<void>((resolve, reject) => {
    const up = new Upload(file, {
      endpoint,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000, 60000],
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'x-upsert': 'true' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: BUCKET, objectName: path, contentType, cacheControl: '3600' },
      onError: reject,
      onProgress: (sent, total) => onProgress(total ? sent / total : 0),
      onSuccess: () => resolve(),
    });
    up.findPreviousUploads().then((prev) => {
      if (prev.length) up.resumeFromPreviousUpload(prev[0]);
      up.start();
    }, reject);
  });
}

/** Small files (thumbnails) go through the standard upload endpoint. */
export async function uploadSmall(path: string, blob: Blob, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: true });
  if (error) throw error;
}
