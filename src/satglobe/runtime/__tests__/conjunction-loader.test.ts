import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConjunctionFeedV1 } from '../../domain/types';
import {
  CONJUNCTION_FEED_MAX_BYTES,
  CONJUNCTION_FEED_PATH,
  CONJUNCTION_PARSE_MEASURE,
  loadConjunctionFeed,
} from '../conjunction-loader';

const CHECKSUM = 'a'.repeat(64);
const VALID_FEED: ConjunctionFeedV1 = {
  schemaVersion: 1,
  snapshotId: 'socrates-2026-07-18-aaaaaaaaaaaa',
  generatedAt: '2026-07-18T07:45:00.000Z',
  source: {
    provider: 'CelesTrak',
    rawUrl: 'https://celestrak.org/SOCRATES/sort-minRange.csv',
    updatedAt: '2026-07-18T07:45:00.000Z',
    retrievedAt: '2026-07-18T08:00:00.000Z',
    checksum: CHECKSUM,
  },
  conjunctions: [
{
    id: 'b'.repeat(24),
    object1: { catalogId: '25544', name: 'ISS (ZARYA)', dseDays: 0 },
    object2: { catalogId: '43013', name: 'OBJECT TWO', dseDays: 1.25 },
    timeOfClosestApproach: '2026-07-19T12:00:00.000Z',
    missDistanceKm: 0,
    relativeSpeedKmS: 12.5,
    maximumProbability: 0,
    dilutionThreshold: 0,
  },
],
};

/** Returns a successful synthetic same-origin JSON response. */
function responseFor(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

/** Captures the performance marks emitted around strict JSON parsing. */
function installPerformanceSpies() {
  const mark = vi.spyOn(performance, 'mark');
  const measure = vi.spyOn(performance, 'measure');
  const clearMarks = vi.spyOn(performance, 'clearMarks');

  return { mark, measure, clearMarks };
}

describe('loadConjunctionFeed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and strictly validates the bounded same-origin artifact', async () => {
    const performanceSpies = installPerformanceSpies();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(responseFor(JSON.stringify(VALID_FEED)));
    const controller = new AbortController();

    await expect(loadConjunctionFeed(controller.signal, { fetchImpl })).resolves.toEqual(VALID_FEED);

    const [url, init] = fetchImpl.mock.calls[0];

    expect(new URL(String(url)).pathname).toBe(CONJUNCTION_FEED_PATH);
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
    });
    expect(performanceSpies.measure).toHaveBeenCalledWith(
      CONJUNCTION_PARSE_MEASURE,
      expect.stringContaining(':start:'),
      expect.stringContaining(':end:'),
    );
  });

  it('rejects cross-origin URLs before issuing a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(loadConjunctionFeed(new AbortController().signal, {
      fetchImpl,
      url: 'https://example.test/conjunctions.json',
    })).rejects.toThrow('must stay on the SatGlobe origin');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a response that followed an off-origin redirect', async () => {
    const response = responseFor(JSON.stringify(VALID_FEED));

    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: 'https://example.test/conjunctions.json' },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(loadConjunctionFeed(new AbortController().signal, { fetchImpl })).rejects.toThrow(
      'must stay on the SatGlobe origin',
    );
  });

  it('rejects an oversized declared response before reading its body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(responseFor(JSON.stringify(VALID_FEED), {
      'content-length': String(CONJUNCTION_FEED_MAX_BYTES + 1),
    }));

    await expect(loadConjunctionFeed(new AbortController().signal, { fetchImpl })).rejects.toThrow('exceeds');
  });

  it('enforces the actual byte ceiling when Content-Length is absent', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(responseFor('x'.repeat(CONJUNCTION_FEED_MAX_BYTES + 1)));

    await expect(loadConjunctionFeed(new AbortController().signal, { fetchImpl })).rejects.toThrow('exceeds');
  });

  it('rejects schema drift instead of accepting unknown feed fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(responseFor(JSON.stringify({ ...VALID_FEED, unexpected: true })));

    await expect(loadConjunctionFeed(new AbortController().signal, { fetchImpl })).rejects.toThrow();
  });

  it('surfaces an HTTP failure without attempting to parse it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('missing', { status: 404 }));

    await expect(loadConjunctionFeed(new AbortController().signal, { fetchImpl })).rejects.toThrow('HTTP 404');
  });
});
