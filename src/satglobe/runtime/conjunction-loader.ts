import { conjunctionFeedV1Schema } from '../domain/conjunctions';
import type { ConjunctionFeedV1 } from '../domain/types';

export const CONJUNCTION_FEED_PATH = '/tle/satglobe/conjunctions.json';
export const CONJUNCTION_FEED_MAX_BYTES = 256 * 1024;
export const CONJUNCTION_PARSE_MEASURE = 'satglobe:conjunction-parse';

interface ConjunctionLoaderOptions {
  fetchImpl?: typeof fetch;
  url?: string;
}

let parseSequence = 0;

/** Reads a response through a hard byte ceiling, including when Content-Length is absent. */
async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length');

  if (declaredLength && (/^\d+$/u).test(declaredLength) && Number(declaredLength) > CONJUNCTION_FEED_MAX_BYTES) {
    throw new Error(`Conjunction feed exceeds the ${CONJUNCTION_FEED_MAX_BYTES}-byte limit.`);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength > CONJUNCTION_FEED_MAX_BYTES) {
      throw new Error(`Conjunction feed exceeds the ${CONJUNCTION_FEED_MAX_BYTES}-byte limit.`);
    }

    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- response chunks must be read in stream order.
      const { done, value } = await reader.read();

      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > CONJUNCTION_FEED_MAX_BYTES) {
        // eslint-disable-next-line no-await-in-loop -- cancel the ordered stream before rejecting its oversized body.
        await reader.cancel();
        throw new Error(`Conjunction feed exceeds the ${CONJUNCTION_FEED_MAX_BYTES}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

/** Parses the small curated feed while recording the browser-visible main-thread cost. */
function parseFeed(bytes: Uint8Array): ConjunctionFeedV1 {
  const sequence = parseSequence++;
  const startMark = `${CONJUNCTION_PARSE_MEASURE}:start:${sequence}`;
  const endMark = `${CONJUNCTION_PARSE_MEASURE}:end:${sequence}`;

  performance.mark(startMark);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

    return conjunctionFeedV1Schema.parse(JSON.parse(text));
  } finally {
    performance.mark(endMark);
    performance.measure(CONJUNCTION_PARSE_MEASURE, startMark, endMark);
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
  }
}

/** Loads SatGlobe's curated, same-origin SOCRATES artifact without joining the boot critical path. */
export async function loadConjunctionFeed(
  signal: AbortSignal,
  { fetchImpl = globalThis.fetch, url = CONJUNCTION_FEED_PATH }: ConjunctionLoaderOptions = {},
): Promise<ConjunctionFeedV1> {
  const baseUrl = globalThis.location?.href ?? 'http://localhost/';
  const resolvedUrl = new URL(url, baseUrl);

  if (resolvedUrl.origin !== new URL(baseUrl).origin) {
    throw new Error('Conjunction feed URL must stay on the SatGlobe origin.');
  }

  const response = await fetchImpl(resolvedUrl.href, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal,
  });

  if (response.redirected || (response.url && new URL(response.url, baseUrl).origin !== resolvedUrl.origin)) {
    throw new Error('Conjunction feed response must stay on the SatGlobe origin.');
  }
  if (!response.ok) {
    throw new Error(`Conjunction feed request failed with HTTP ${response.status}.`);
  }

  return parseFeed(await readBoundedBody(response));
}
