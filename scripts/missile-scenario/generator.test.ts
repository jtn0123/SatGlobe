import { makeRng } from './generator';

describe('missile scenario PRNG', () => {
  it('preserves the established mulberry32 sequence without bitwise truncation assignments', () => {
    const rng = makeRng(1);

    expect(Array.from({ length: 5 }, () => rng())).toEqual([
      0.6270739405881613,
      0.002735721180215478,
      0.5274470399599522,
      0.9810509674716741,
      0.9683778982143849,
    ]);
  });

  it('is deterministic for the same seed', () => {
    const first = makeRng(0xdeadbeef);
    const second = makeRng(0xdeadbeef);

    expect(Array.from({ length: 20 }, () => first())).toEqual(Array.from({ length: 20 }, () => second()));
  });
});
