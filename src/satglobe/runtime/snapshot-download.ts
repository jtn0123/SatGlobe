const PNG_MIME_TYPE = 'image/png';

/** Builds a filesystem-safe, sortable UTC filename for a captured frame. */
export function snapshotFilename(context = 'view', now = new Date()): string {
  const safeContext = context.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'view';
  const timestamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');

  return `satglobe-${safeContext}-${timestamp}.png`;
}

/** Downloads a PNG through a short-lived object URL without retaining the blob. */
export function downloadSnapshot(
  blob: Blob,
  context = 'view',
  documentRef: Document = document,
  urlApi: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
): string {
  if (blob.size === 0 || blob.type !== PNG_MIME_TYPE) {
    throw new Error('The captured frame is not a valid PNG blob.');
  }

  const filename = snapshotFilename(context);
  const objectUrl = urlApi.createObjectURL(blob);
  let anchor: HTMLAnchorElement | null = null;

  try {
    anchor = documentRef.createElement('a');
    anchor.download = filename;
    anchor.href = objectUrl;
    anchor.hidden = true;
    documentRef.body.append(anchor);
    anchor.click();
  } finally {
    try {
      anchor?.remove();
    } finally {
      urlApi.revokeObjectURL(objectUrl);
    }
  }

  return filename;
}
