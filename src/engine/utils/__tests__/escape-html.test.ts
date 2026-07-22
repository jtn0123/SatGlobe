import { escapeHtml } from '@app/engine/utils/escape-html';

describe('escapeHtml', () => {
  it('escapes every occurrence of all HTML-significant characters', () => {
    expect(escapeHtml('&<>"\' &<>"\'')).toBe(
      '&amp;&lt;&gt;&quot;&#39; &amp;&lt;&gt;&quot;&#39;',
    );
  });

  it('leaves safe text and Unicode unchanged', () => {
    expect(escapeHtml('SatGlobe – 日本語')).toBe('SatGlobe – 日本語');
  });
});
