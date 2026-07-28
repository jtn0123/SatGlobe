import { ServiceLocator } from '@app/engine/core/service-locator';
import type { WebGLRenderer } from '@app/engine/rendering/webgl-renderer';
import { setupStandardEnvironment } from '@test/environment/standard-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BlobCallback = (blob: Blob | null) => void;

/** Installs a controllable PNG encoder on the standard renderer canvas. */
function rendererWithEncoder(encoder: (callback: BlobCallback, type?: string) => void): WebGLRenderer {
  const renderer = ServiceLocator.getRenderer();

  Object.defineProperty(renderer.domElement, 'toBlob', {
    configurable: true,
    value: vi.fn(encoder),
  });
  renderer.isContextLost = false;
  vi.spyOn(renderer.gl, 'isContextLost').mockReturnValue(false);

  return renderer;
}

describe('WebGLRenderer frame capture', () => {
  beforeEach(() => setupStandardEnvironment());
  afterEach(() => vi.restoreAllMocks());

  it('encodes the completed frame exactly once and owns the slot through async completion', async () => {
    let complete: BlobCallback | null = null;
    const renderer = rendererWithEncoder((callback, type) => {
      expect(type).toBe('image/png');
      complete = callback;
    });
    const capture = renderer.captureNextFrame();

    expect(renderer.domElement.toBlob).not.toHaveBeenCalled();
    await expect(renderer.captureNextFrame()).rejects.toThrow('already in progress');

    renderer.flushNextFrameCapture();
    renderer.flushNextFrameCapture();

    expect(renderer.domElement.toBlob).toHaveBeenCalledTimes(1);
    await expect(renderer.captureNextFrame()).rejects.toThrow('already in progress');

    const png = new Blob(['png'], { type: 'image/png' });

    complete!(png);
    await expect(capture).resolves.toBe(png);

    const next = renderer.captureNextFrame();

    renderer.flushNextFrameCapture();
    complete!(png);
    await expect(next).resolves.toBe(png);
    expect(renderer.domElement.toBlob).toHaveBeenCalledTimes(2);
  });

  it('rejects a null blob and releases the slot for a later request', async () => {
    const renderer = rendererWithEncoder((callback) => callback(null));
    const capture = renderer.captureNextFrame();

    renderer.flushNextFrameCapture();
    await expect(capture).rejects.toThrow('empty PNG');

    const next = renderer.captureNextFrame();

    renderer.flushNextFrameCapture();
    await expect(next).rejects.toThrow('empty PNG');
  });

  it('rejects synchronous encoder exceptions and releases the slot', async () => {
    const renderer = rendererWithEncoder(() => {
      throw new Error('encoder unavailable');
    });
    const capture = renderer.captureNextFrame();

    renderer.flushNextFrameCapture();
    await expect(capture).rejects.toThrow('encoder unavailable');

    const next = renderer.captureNextFrame();

    renderer.flushNextFrameCapture();
    await expect(next).rejects.toThrow('encoder unavailable');
  });

  it('rejects missing canvas, lost context, and context-inspection exceptions', async () => {
    const renderer = rendererWithEncoder(() => undefined);
    const canvas = renderer.domElement;

    renderer.domElement = null as unknown as HTMLCanvasElement;
    await expect(renderer.captureNextFrame()).rejects.toThrow('canvas is unavailable');

    renderer.domElement = canvas;
    renderer.isContextLost = true;
    await expect(renderer.captureNextFrame()).rejects.toThrow('context is unavailable');

    renderer.isContextLost = false;
    vi.mocked(renderer.gl.isContextLost).mockImplementation(() => {
      throw new Error('driver error');
    });
    await expect(renderer.captureNextFrame()).rejects.toThrow('context is unavailable');
  });

  it('settles an encoding capture when WebGL reports context loss', async () => {
    const renderer = rendererWithEncoder(() => undefined);
    const capture = renderer.captureNextFrame();
    const event = { preventDefault: vi.fn() } as unknown as WebGLContextEvent;

    renderer.flushNextFrameCapture();
    (renderer as unknown as { onContextLost_: (event: WebGLContextEvent) => void }).onContextLost_(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    await expect(capture).rejects.toThrow('context was lost');
  });

  it('rejects and releases an encoding capture during consumer teardown', async () => {
    const renderer = rendererWithEncoder(() => undefined);
    const capture = renderer.captureNextFrame();

    renderer.flushNextFrameCapture();
    renderer.cancelFrameCapture();

    await expect(capture).rejects.toThrow('cancelled during teardown');
    const next = renderer.captureNextFrame();

    renderer.cancelFrameCapture();
    await expect(next).rejects.toThrow('cancelled during teardown');
  });
});
