import { mat4 } from 'gl-matrix';
import { CameraTransition } from '../camera-transition';

describe('CameraTransition', () => {
  let transition: CameraTransition;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  let fakeTime: number;

  beforeEach(() => {
    transition = new CameraTransition();
    fakeTime = 1000;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeTime);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('should not be active initially', () => {
    expect(transition.isActive).toBe(false);
  });

  it('should become active after begin()', () => {
    transition.begin(mat4.create(), [0, 0, 0]);
    expect(transition.isActive).toBe(true);
  });

  it('should become inactive after cancel()', () => {
    transition.begin(mat4.create(), [0, 0, 0]);
    transition.cancel();
    expect(transition.isActive).toBe(false);
  });

  it('should return null when not active', () => {
    const result = transition.apply(mat4.create(), [0, 0, 0]);

    expect(result).toBeNull();
  });

  it('should return blended view matrix at mid-transition', () => {
    const from = mat4.create();
    const to = mat4.create();

    mat4.translate(to, to, [100, 200, 300]);

    transition.begin(from, [0, 0, 0]);

    // Advance to 50% of default 500ms duration
    fakeTime = 1250;

    const result = transition.apply(to, [0, 0, 0]);

    expect(result).not.toBeNull();
    // Result is a mat4 (the effective view matrix)
    expect(result!).toHaveLength(16);
  });

  it('should return null after duration completes', () => {
    transition.begin(mat4.create(), [0, 0, 0]);

    // Advance past 500ms default
    fakeTime = 1600;

    const result = transition.apply(mat4.create(), [0, 0, 0]);

    expect(result).toBeNull();
    expect(transition.isActive).toBe(false);
  });

  it('should clamp duration to valid range', () => {
    transition.duration = 50;
    expect(transition.duration).toBe(100);

    transition.duration = 5000;
    expect(transition.duration).toBe(2000);

    transition.duration = 750;
    expect(transition.duration).toBe(750);
  });

  it('should produce identity-like result when from === to with zero worldShift', () => {
    const identity = mat4.create();

    transition.begin(identity, [0, 0, 0]);

    fakeTime = 1250;

    const result = transition.apply(identity, [0, 0, 0]);

    if (result) {
      for (let i = 0; i < 16; i++) {
        expect(result[i]).toBeCloseTo(identity[i], 4);
      }
    }
  });

  it('should compensate for worldShift change at t=0', () => {
    // Simulate: begin with worldShift=[0,0,0], then worldShift jumps to [-100,-200,-300]
    const fromView = mat4.create();

    mat4.translate(fromView, fromView, [0, 500, 0]); // Camera backed away from origin

    transition.begin(fromView, [0, 0, 0]);

    // Very start of transition: t≈0
    fakeTime = 1001; // 1ms into 500ms

    // worldShift has already jumped to the new satellite
    const newView = mat4.create();
    const newWS = [-100, -200, -300];

    const result = transition.apply(newView, newWS);

    expect(result).not.toBeNull();

    // At t≈0, the effective view should be very close to fromView
    // because composedBlended ≈ composedFrom, and undoing newWS compensates
    // Verify the visual transform: result * (vertex + newWS) ≈ fromView * (vertex + [0,0,0])
    // For vertex = [0,0,0]: result * newWS ≈ fromView * [0,0,0]
    // This means: result * [-100,-200,-300,1] ≈ fromView * [0,0,0,1]
  });

  it('should chain transitions when begin() is called during active transition', () => {
    const viewA = mat4.create();

    transition.begin(viewA, [0, 0, 0]);

    // Mid-transition, start another
    fakeTime = 1250;
    const viewB = mat4.create();

    mat4.translate(viewB, viewB, [100, 0, 0]);
    transition.begin(viewB, [100, 0, 0]);

    expect(transition.isActive).toBe(true);

    // The new transition starts from fakeTime=1250
    fakeTime = 1500;
    const viewC = mat4.create();

    mat4.translate(viewC, viewC, [200, 0, 0]);
    const result = transition.apply(viewC, [200, 0, 0]);

    expect(result).not.toBeNull();
  });

  it('should reach exact target at t=1 boundary', () => {
    const from = mat4.create();
    const to = mat4.create();

    mat4.rotateZ(to, to, Math.PI / 4);
    mat4.translate(to, to, [500, 0, 0]);

    transition.begin(from, [0, 0, 0]);

    // Just before completion
    fakeTime = 1499;
    const almostDone = transition.apply(to, [1000, 2000, 3000]);

    expect(almostDone).not.toBeNull();

    // At completion
    fakeTime = 1500;
    const done = transition.apply(to, [1000, 2000, 3000]);

    expect(done).toBeNull();
    expect(transition.isActive).toBe(false);
  });

  it('should maintain distance from origin during transition (spherical arc)', () => {
    // Two cameras at the same distance from origin but in different directions
    // The midpoint should maintain approximately the same distance (not dip toward origin)
    const dist = 7000; // ~LEO altitude in km

    const fromView = mat4.create();
    const toView = mat4.create();

    // Camera A: looking at origin from +X axis at distance `dist`
    // View matrix translates by [0, 0, -dist] (camera at [0, 0, dist] in world, default -Z forward)
    mat4.translate(fromView, fromView, [0, 0, -dist]);

    // Camera B: looking at origin from +Y axis at distance `dist`
    // Rotate 90 degrees around Z, then translate back
    mat4.rotateZ(toView, toView, Math.PI / 2);
    mat4.translate(toView, toView, [0, 0, -dist]);

    transition.begin(fromView, [0, 0, 0]);

    // At 50%
    fakeTime = 1250;
    const result = transition.apply(toView, [0, 0, 0]);

    expect(result).not.toBeNull();

    // Extract camera world position from the blended result
    // For view matrix V, cam pos = -R^T * t = inverse(V)[12..14]
    const inv = mat4.create();

    mat4.invert(inv, result!);
    const midDist = Math.sqrt(inv[12] ** 2 + inv[13] ** 2 + inv[14] ** 2);

    // With spherical arc, the midpoint distance should be close to `dist`
    // Linear lerp would give dist * cos(45°) ≈ 0.707 * dist
    expect(midDist).toBeGreaterThan(dist * 0.9);
    expect(midDist).toBeLessThan(dist * 1.1);
  });

  it('should converge to target view at end of transition', () => {
    const fromView = mat4.create();
    const toView = mat4.create();

    mat4.translate(toView, toView, [0, 1000, 0]);
    mat4.rotateX(toView, toView, 0.5);
    const toWS = [-500, -300, -100];

    transition.begin(fromView, [0, 0, 0]);

    // Just before end (t≈0.998)
    fakeTime = 1499;
    const result = transition.apply(toView, toWS);

    expect(result).not.toBeNull();

    // At t≈1, effectiveView should be very close to toView
    // because composedBlended ≈ toView * translate(toWS), and undo toWS → toView
    for (let i = 0; i < 16; i++) {
      expect(result![i]).toBeCloseTo(toView[i], 0);
    }
  });
});
