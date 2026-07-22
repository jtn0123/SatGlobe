import { readFileSync } from 'node:fs';

const html = readFileSync('scripts/mesh-viewer/index.html', 'utf8');
const publicIndex = readFileSync('public/index.html', 'utf8');

describe('mesh viewer accessibility', () => {
  it('associates every visible control with text', () => {
    expect(html).toContain('<label class="visually-hidden" for="filter">Filter meshes</label>');
    expect(html).toContain('<label for="sun-az">az</label>');
    expect(html).toContain('<label for="sun-el">el</label>');
  });

  it('gives the generated data table stable headers and a caption', () => {
    expect(html).toContain('<caption class="visually-hidden">Mesh dimensions and geometry counts</caption>');
    expect(html).toContain('<th scope="col">Measurement</th>');
    expect(html).toContain('<th scope="col">Value</th>');
  });

  it('allows browser and assistive-technology zoom', () => {
    expect(publicIndex).not.toContain('user-scalable=no');
    expect(publicIndex).not.toContain('maximum-scale');
  });
});
