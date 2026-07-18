/** A fixed-size three-dimensional vector. */
export type Vector3Tuple = readonly [number, number, number];

/** A fixed-size 4 by 4 matrix. */
export type Matrix4 = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
];

const MATRIX_ORDER = 4;

/** Computes a three-dimensional dot product without runtime code generation. */
export const dotProduct3 = (left: Vector3Tuple, right: Vector3Tuple): number =>
  left[2] * right[2] + (left[1] * right[1] + left[0] * right[0]);

/**
 * Inverts a 4 by 4 matrix with Gauss-Jordan elimination and partial pivoting.
 * Returns null for singular or non-finite inputs instead of leaking NaN/Infinity.
 */
export const invertMatrix4 = (matrix: Matrix4): Matrix4 | null => {
  const scale = Math.max(...matrix.flatMap((row) => row.map((value) => Math.abs(value))));

  if (!Number.isFinite(scale) || scale === 0) {
    return null;
  }

  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: MATRIX_ORDER }, (_, columnIndex) => Number(rowIndex === columnIndex)),
  ]);
  const pivotTolerance = Number.EPSILON * MATRIX_ORDER * scale;

  for (let column = 0; column < MATRIX_ORDER; column++) {
    let pivotRow = column;

    for (let row = column + 1; row < MATRIX_ORDER; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(augmented[pivotRow][column]) <= pivotTolerance) {
      return null;
    }

    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];

    for (let index = 0; index < MATRIX_ORDER * 2; index++) {
      augmented[column][index] /= pivot;
    }

    for (let row = 0; row < MATRIX_ORDER; row++) {
      if (row === column) {
        continue;
      }

      const factor = augmented[row][column];

      for (let index = 0; index < MATRIX_ORDER * 2; index++) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  const inverse = augmented.map((row) => row.slice(MATRIX_ORDER)) as Matrix4;

  return inverse.flat().every(Number.isFinite) ? inverse : null;
};
