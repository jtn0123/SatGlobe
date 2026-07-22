import { mat4, quat, vec3 } from 'gl-matrix';

/**
 * Handles smooth blending between camera states during satellite selection changes.
 *
 * Blends the COMPOSED transform (viewMatrix * translate(worldShift)) rather than
 * blending view matrix and worldShift independently. This is correct because:
 * - In satellite-centered modes, worldShift is baked into the view matrix eye position
 * - In earth-centered mode, worldShift is only applied in shaders
 * - Blending the composed transform captures the full visual pipeline consistently
 *
 * Camera positions are interpolated along a spherical arc around the Earth center
 * (slerp direction + lerp distance) to prevent the camera from dipping toward Earth
 * during transitions between widely-separated targets.
 *
 * After blending, the current frame's worldShift is "undone" from the composed result
 * to produce the effective view matrix that, combined with the shader's worldShift
 * application, produces the correct blended visual.
 *
 * All buffers are pre-allocated to avoid GC pressure during transitions.
 */
export class CameraTransition {
  /** Position finishes at this fraction of the total duration (rotation uses full duration). */
  private static readonly POSITION_TIME_RATIO_ = 0.6;

  private isActive_ = false;
  private startTime_ = 0;
  private duration_ = 500;

  // Composed "from" state: viewMatrix * translate(worldShift)
  private readonly fromComposed_ = mat4.create();

  // Temp buffer for composing current frame's transform
  private readonly toComposed_ = mat4.create();

  // Decomposition buffers
  private readonly fromRotation_ = quat.create();
  private readonly fromTranslation_ = vec3.create();
  private readonly toRotation_ = quat.create();
  private readonly toTranslation_ = vec3.create();

  // Camera world positions (for spherical arc interpolation)
  private readonly fromCamPos_ = vec3.create();
  private readonly toCamPos_ = vec3.create();
  private readonly blendedCamPos_ = vec3.create();

  // Direction buffers for spherical arc
  private readonly fromDir_ = vec3.create();
  private readonly toDir_ = vec3.create();
  private blendedDir_ = vec3.create();

  // Blending output buffers
  private readonly blendedRotation_ = quat.create();
  private readonly blendedTranslation_ = vec3.create();
  private blendedComposed_ = mat4.create();
  private readonly effectiveViewMatrix_ = mat4.create();

  // Temp 3x3 rotation matrices for quat.fromMat3
  private readonly rotMat3From_ = new Float32Array(9);
  private readonly rotMat3To_ = new Float32Array(9);

  // Temp vec3 for worldShift translation
  private readonly wsVec3_ = vec3.create();

  // Temp quat for conjugate operations
  private readonly tempQuat_ = quat.create();

  get isActive(): boolean {
    return this.isActive_;
  }

  get duration(): number {
    return this.duration_;
  }

  set duration(ms: number) {
    this.duration_ = Math.max(100, Math.min(2000, ms));
  }

  /**
   * Start a new transition from the current visual state.
   * Saves the composed transform: viewMatrix * translate(worldShift).
   * If a transition is already active, the current blended state
   * (already written to matrixWorldInverse by draw()) becomes the new start.
   */
  begin(currentViewMatrix: mat4, currentWorldShift: number[]): void {
    // Compose: viewMatrix * translate(worldShift)
    mat4.copy(this.fromComposed_, currentViewMatrix);
    vec3.set(this.wsVec3_, currentWorldShift[0], currentWorldShift[1], currentWorldShift[2]);
    mat4.translate(this.fromComposed_, this.fromComposed_, this.wsVec3_);

    this.startTime_ = performance.now();
    this.isActive_ = true;
  }

  /** Immediately end the transition. The current (new) values are used as-is. */
  cancel(): void {
    this.isActive_ = false;
  }

  /**
   * Compute the effective view matrix for the current frame by blending
   * the saved composed transform toward the current composed transform,
   * then undoing the current worldShift.
   *
   * Camera positions are interpolated along a spherical arc around the origin
   * (great-circle path for direction, linear for distance) to prevent the camera
   * from dipping toward Earth during transitions.
   *
   * Returns the effective view matrix, or null when the transition is complete/inactive.
   * Does NOT modify worldShift — let it stay at whatever the pipeline set.
   */
  apply(
    currentViewMatrix: mat4,
    currentWorldShift: number[],
  ): mat4 | null {
    if (!this.isActive_) {
      return null;
    }

    const elapsed = performance.now() - this.startTime_;
    const rawT = Math.min(elapsed / this.duration_, 1);

    if (rawT >= 1) {
      this.isActive_ = false;

      return null;
    }

    // Position completes at 60% of the total duration, rotation uses the full duration.
    // This makes the camera arrive at its destination first, then finish rotating.
    const posRawT = Math.min(rawT / CameraTransition.POSITION_TIME_RATIO_, 1);

    // Hermite smoothstep: zero derivative at both endpoints
    const tRot = rawT * rawT * (3 - 2 * rawT);
    const tPos = posRawT * posRawT * (3 - 2 * posRawT);

    // Compose current frame's transform: currentView * translate(currentWS)
    mat4.copy(this.toComposed_, currentViewMatrix);
    vec3.set(this.wsVec3_, currentWorldShift[0], currentWorldShift[1], currentWorldShift[2]);
    mat4.translate(this.toComposed_, this.toComposed_, this.wsVec3_);

    // Decompose both composed matrices into rotation + translation
    this.decomposeViewMatrix_(this.fromComposed_, this.rotMat3From_, this.fromRotation_, this.fromTranslation_);
    this.decomposeViewMatrix_(this.toComposed_, this.rotMat3To_, this.toRotation_, this.toTranslation_);

    // Slerp rotation over the full duration
    quat.slerp(this.blendedRotation_, this.fromRotation_, this.toRotation_, tRot);

    // Extract camera world positions: p = -R^T * t (where R^T = conjugate(q))
    this.extractCameraWorldPos_(this.fromRotation_, this.fromTranslation_, this.fromCamPos_);
    this.extractCameraWorldPos_(this.toRotation_, this.toTranslation_, this.toCamPos_);

    // Spherical arc interpolation of camera position (finishes earlier than rotation)
    this.sphericalArcLerp_(this.fromCamPos_, this.toCamPos_, tPos, this.blendedCamPos_);

    // Reconstruct translation from blended rotation and camera position: t = -R * p
    this.computeViewTranslation_(this.blendedRotation_, this.blendedCamPos_, this.blendedTranslation_);

    // Recompose blended composed matrix
    mat4.fromQuat(this.blendedComposed_, this.blendedRotation_);
    this.blendedComposed_[12] = this.blendedTranslation_[0];
    this.blendedComposed_[13] = this.blendedTranslation_[1];
    this.blendedComposed_[14] = this.blendedTranslation_[2];

    // Undo current worldShift: effectiveView = blendedComposed * translate(-currentWS)
    vec3.set(this.wsVec3_, -currentWorldShift[0], -currentWorldShift[1], -currentWorldShift[2]);
    mat4.translate(this.effectiveViewMatrix_, this.blendedComposed_, this.wsVec3_);

    return this.effectiveViewMatrix_;
  }

  /**
   * Extract camera world position from rotation quat and translation vec3.
   * For a view matrix V = [R | t], camera world pos p = -R^T * t.
   */
  private extractCameraWorldPos_(rotation: quat, translation: vec3, out: vec3): void {
    // out = -t
    vec3.set(out, -translation[0], -translation[1], -translation[2]);
    // Apply inverse rotation: R^T * (-t) = conjugate(q) applied to (-t)
    quat.conjugate(this.tempQuat_, rotation);
    vec3.transformQuat(out, out, this.tempQuat_);
  }

  /**
   * Compute view matrix translation from rotation quat and camera world position.
   * t = -R * p, which is q applied to (-p).
   */
  private computeViewTranslation_(rotation: quat, camPos: vec3, out: vec3): void {
    vec3.set(out, -camPos[0], -camPos[1], -camPos[2]);
    vec3.transformQuat(out, out, rotation);
  }

  /**
   * Interpolate between two 3D positions along a spherical arc around the origin.
   * Direction is slerped (great-circle arc), distance is linearly interpolated.
   * Falls back to linear lerp when positions are near the origin or nearly parallel.
   */
  private sphericalArcLerp_(from: vec3, to: vec3, t: number, out: vec3): void {
    const distFrom = vec3.length(from);
    const distTo = vec3.length(to);

    // Fall back to linear lerp if either position is at the origin
    if (distFrom < 1e-6 || distTo < 1e-6) {
      vec3.lerp(out, from, to, t);

      return;
    }

    // Normalize directions
    vec3.scale(this.fromDir_, from, 1 / distFrom);
    vec3.scale(this.toDir_, to, 1 / distTo);

    // Slerp direction on great circle
    const cosOmega = Math.max(-1, Math.min(1, vec3.dot(this.fromDir_, this.toDir_)));

    if (cosOmega > 0.9999) {
      // Nearly parallel — linear lerp is fine
      vec3.lerp(out, from, to, t);

      return;
    }

    const omega = Math.acos(cosOmega);
    const sinOmega = Math.sin(omega);
    const sa = Math.sin((1 - t) * omega) / sinOmega;
    const sb = Math.sin(t * omega) / sinOmega;

    this.blendedDir_[0] = sa * this.fromDir_[0] + sb * this.toDir_[0];
    this.blendedDir_[1] = sa * this.fromDir_[1] + sb * this.toDir_[1];
    this.blendedDir_[2] = sa * this.fromDir_[2] + sb * this.toDir_[2];

    // Lerp distance
    const dist = distFrom + (distTo - distFrom) * t;

    // Scale direction by distance
    vec3.scale(out, this.blendedDir_, dist);
  }

  /**
   * Extract rotation quaternion and translation from an orthonormal view matrix.
   * Column-major 4x4 → column-major 3x3 extraction for the rotation part.
   */
  private decomposeViewMatrix_(m: mat4, rotMat3: Float32Array, outRotation: quat, outTranslation: vec3): void {
    outTranslation[0] = m[12];
    outTranslation[1] = m[13];
    outTranslation[2] = m[14];

    // Extract upper-left 3x3 (column-major)
    rotMat3[0] = m[0];
    rotMat3[1] = m[1];
    rotMat3[2] = m[2];
    rotMat3[3] = m[4];
    rotMat3[4] = m[5];
    rotMat3[5] = m[6];
    rotMat3[6] = m[8];
    rotMat3[7] = m[9];
    rotMat3[8] = m[10];

    quat.fromMat3(outRotation, rotMat3);
    quat.normalize(outRotation, outRotation);
  }
}
