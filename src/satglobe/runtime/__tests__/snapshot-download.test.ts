import { describe, expect, it, vi } from 'vitest';
import { downloadSnapshot, snapshotFilename } from '../snapshot-download';

describe('snapshot download', () => {
  it('uses a sanitized context and filesystem-safe UTC timestamp', () => {
    expect(snapshotFilename('GPS Story / 01', new Date('2026-07-18T12:34:56.789Z')))
      .toBe('satglobe-gps-story-01-20260718T123456Z.png');
  });

  it('clicks a temporary PNG link and always revokes its object URL', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { click, remove } as unknown as HTMLAnchorElement;
    const documentRef = {
      body: { append: vi.fn() },
      createElement: vi.fn(() => anchor),
    } as unknown as Document;
    const urlApi = {
      createObjectURL: vi.fn(() => 'blob:satglobe-snapshot'),
      revokeObjectURL: vi.fn(),
    };
    const filename = downloadSnapshot(new Blob(['png'], { type: 'image/png' }), 'view', documentRef, urlApi);

    expect(filename).toMatch(/^satglobe-view-\d{8}T\d{6}Z\.png$/u);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(anchor.download).toBe(filename);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:satglobe-snapshot');
  });

  it('revokes the object URL when link setup throws', () => {
    const documentRef = document.implementation.createHTMLDocument();
    const urlApi = {
      createObjectURL: vi.fn(() => 'blob:satglobe-snapshot'),
      revokeObjectURL: vi.fn(),
    };

    vi.spyOn(documentRef.body, 'append').mockImplementation(() => {
      throw new Error('document unavailable');
    });

    expect(() => downloadSnapshot(new Blob(['png'], { type: 'image/png' }), 'view', documentRef, urlApi)).toThrow('document unavailable');
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:satglobe-snapshot');
  });

  it.each([
    new Blob([], { type: 'image/png' }),
    new Blob(['not png'], { type: 'text/plain' }),
  ])('rejects an empty or non-PNG blob before allocating a URL', (blob) => {
    const urlApi = {
      createObjectURL: vi.fn(() => 'blob:unused'),
      revokeObjectURL: vi.fn(),
    };

    expect(() => downloadSnapshot(blob, 'view', document, urlApi)).toThrow('not a valid PNG');
    expect(urlApi.createObjectURL).not.toHaveBeenCalled();
  });
});
