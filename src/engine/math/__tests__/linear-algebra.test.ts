import { dotProduct3, invertMatrix4, type Matrix4 } from '@app/engine/math/linear-algebra';

describe('dotProduct3', () => {
  it('matches the established three-vector result', () => {
    expect(dotProduct3([1, 2, 3], [4, 5, 6])).toBe(32);
  });
});

describe('invertMatrix4', () => {
  it('uses a row pivot and preserves the input matrix', () => {
    const matrix: Matrix4 = [
      [0, 2, 0, 0],
      [1, 0, 0, 0],
      [0, 0, 4, 0],
      [0, 0, 0, 5],
    ];
    const original = matrix.map((row) => [...row]);

    expect(invertMatrix4(matrix)).toEqual([
      [0, 1, 0, 0],
      [0.5, 0, 0, 0],
      [0, 0, 0.25, 0],
      [0, 0, 0, 0.2],
    ]);
    expect(matrix).toEqual(original);
  });

  it('rejects singular and non-finite matrices', () => {
    const singular: Matrix4 = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ];
    const nonFinite: Matrix4 = [
      [Number.NaN, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];

    expect(invertMatrix4(singular)).toBeNull();
    expect(invertMatrix4(nonFinite)).toBeNull();
  });
});
