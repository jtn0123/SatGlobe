import { describe, expect, it } from 'vitest';
import { extractHtmlTags } from './html-tags';

describe('extractHtmlTags', () => {
  it('continues scanning for valid tags after a comparison operator', () => {
    expect(extractHtmlTags('2 < 3 <strong>x</strong>')).toEqual(['</strong>', '<strong>']);
  });

  it('sorts accepted opening and closing tags consistently', () => {
    expect(extractHtmlTags('<em>first</em><br>')).toEqual(['</em>', '<br>', '<em>']);
  });
});
