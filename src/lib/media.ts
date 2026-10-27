import exifr from 'exifr';

export interface PhotoMeta { lat: number | null; lng: number | null; takenAt: Date | null; pitch: number | null; thermal: boolean }

export async function readMeta(file: File): Promise<PhotoMeta> {
  try {
    const [gps, tags, xmp] = await Promise.all([
      exifr.gps(file).catch(() => undefined),
      exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']).catch(() => undefined),
      // DJI drone metadata (XMP drone-dji:*): gimbal pitch (-90 = nadir) and which camera took it
      exifr.parse(file, { xmp: true, tiff: false }).catch(() => undefined),
    ]);
    const rawPitch = Number(xmp?.GimbalPitchDegree);
    const pitch = Number.isFinite(rawPitch) && Math.abs(rawPitch) <= 180 ? rawPitch : null;
    const thermal = xmp?.ImageSource === 'InfraredCamera' || /_T\.jpe?g$/i.test(file.name);
    const lat = gps && Number.isFinite(gps.latitude) ? gps.latitude : null;
    const lng = gps && Number.isFinite(gps.longitude) ? gps.longitude : null;
    const d = tags?.DateTimeOriginal ?? tags?.CreateDate ?? tags?.ModifyDate;
    const takenAt = d instanceof Date && !isNaN(d.getTime()) ? d : null;
    // (0,0) is almost always a bogus GPS fix
    if (lat === 0 && lng === 0) return { lat: null, lng: null, takenAt, pitch, thermal };
    return { lat, lng, takenAt, pitch, thermal };
  } catch {
    return { lat: null, lng: null, takenAt: null, pitch: null, thermal: false };
  }
}

/** Client-side JPEG thumbnail (longest edge `max` px). Returns null if the browser can't decode the image (e.g. HEIC/RAW). */
export async function makeThumb(file: File, max = 480): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.75));
  } catch {
    return null;
  }
}

export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
