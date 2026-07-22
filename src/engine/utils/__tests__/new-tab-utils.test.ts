import { vi } from 'vitest';
import { NewTabUtils } from '@app/engine/utils/new-tab-utils';

describe('NewTabUtils.varToNewTab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a download link and formatted details without document.write', () => {
    const popupDocument = document.implementation.createHTMLDocument();
    const fakeWin = {
      document: popupDocument,
      history: { replaceState: vi.fn() },
    };

    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    NewTabUtils.varToNewTab({ alpha: 1, beta: 'x' }, 'My Vars');

    const downloadLink = popupDocument.querySelector('a');
    const details = popupDocument.querySelector('pre');

    expect(downloadLink?.textContent).toBe('Download My Vars');
    expect(downloadLink?.download).toBe('my-vars.txt');
    expect(downloadLink?.href).toContain(encodeURIComponent('alpha: 1'));
    expect(details?.textContent).toBe('alpha: 1\nbeta: "x"');
    expect(popupDocument.title).toBe('My Vars');
    expect(fakeWin.history.replaceState).toHaveBeenCalledWith(null, 'My Vars', '/my-vars.txt');
  });

  it('renders names and values as text rather than executable markup', () => {
    const popupDocument = document.implementation.createHTMLDocument();
    const fakeWin = {
      document: popupDocument,
      history: { replaceState: vi.fn() },
    };

    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    NewTabUtils.varToNewTab({ payload: '<img src=x onerror=alert(1)>' }, '<script>alert(1)</script>');

    expect(popupDocument.querySelector('script')).toBeNull();
    expect(popupDocument.querySelector('img')).toBeNull();
    expect(popupDocument.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('does nothing (no throw) when the popup is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(() => NewTabUtils.varToNewTab({ a: 1 })).not.toThrow();
  });
});
