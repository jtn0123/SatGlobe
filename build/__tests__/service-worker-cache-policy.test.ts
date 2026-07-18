import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SERVICE_WORKER_SOURCE = readFileSync(resolve(process.cwd(), 'public/serviceWorker.js'), 'utf8');
const ORIGIN = 'https://satglobe.test';

type FetchEvent = {
  request: Request;
  respondWith(response: Promise<Response>): void;
  waitUntil(lifetime: Promise<unknown>): void;
};

type FetchListener = (event: FetchEvent) => void;

/** Execute the production worker with observable fetch and cache collaborators. */
function createHarness() {
  let fetchListener: FetchListener | undefined;
  const lifetimePromises: Array<Promise<unknown>> = [];
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const cacheStorage = {
    delete: vi.fn().mockResolvedValue(true),
    keys: vi.fn().mockResolvedValue([]),
    match: vi.fn<() => Promise<Response | undefined>>(),
    open: vi.fn().mockResolvedValue(cache),
  };
  const fetchMock = vi.fn<typeof fetch>();
  const worker = {
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    addEventListener: vi.fn((type: string, listener: FetchListener) => {
      if (type === 'fetch') {
        fetchListener = listener;
      }
    }),
  };

  runInNewContext(SERVICE_WORKER_SOURCE, {
    AbortController,
    caches: cacheStorage,
    clearTimeout,
    fetch: fetchMock,
    Response,
    self: worker,
    setTimeout,
    URL,
  });

  if (!fetchListener) {
    throw new Error('The service worker did not register a fetch listener.');
  }

  const request = (path: string): Promise<Response> => {
    let responsePromise: Promise<Response> | undefined;

    fetchListener?.({
      request: new Request(`${ORIGIN}${path}`),
      respondWith: (response) => {
        responsePromise = response;
      },
      waitUntil: (lifetime) => {
        lifetimePromises.push(lifetime);
      },
    });
    if (!responsePromise) {
      throw new Error(`The service worker did not handle ${path}.`);
    }

    return responsePromise;
  };

  return { cache, cacheStorage, fetchMock, lifetimePromises, request };
}

describe('service-worker catalog cache policy', () => {
  it('returns fresh installed catalog JSON even when an older response is cached', async () => {
    const { cache, cacheStorage, fetchMock, lifetimePromises, request } = createHarness();

    cacheStorage.match.mockResolvedValue(new Response('stale catalog'));
    fetchMock.mockResolvedValue(new Response('fresh catalog'));

    const response = await request('/tle/tle.json');

    expect(await response.text()).toBe('fresh catalog');
    expect(cacheStorage.match).not.toHaveBeenCalled();
    expect(lifetimePromises).toHaveLength(1);
    await Promise.all(lifetimePromises);
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('uses the cached catalog report only when the network is unavailable', async () => {
    const { cacheStorage, fetchMock, request } = createHarness();
    const cached = new Response('offline manifest');

    cacheStorage.match.mockResolvedValue(cached);
    fetchMock.mockRejectedValue(new TypeError('offline'));

    const response = await request('/tle/satglobe/manifest.json');

    expect(response).toBe(cached);
    expect(await response.text()).toBe('offline manifest');
    expect(cacheStorage.match).toHaveBeenCalledOnce();
  });
});
