// Interactive orbit camera controller (mouse-driven). Owns its own perspective
// projection and a yaw/pitch/distance orbit around a target point, and produces
// the same FrameCamera data (viewProj + eye) both the raster and path-tracing
// backends consume (src/main.ts). It is seeded from the scene's initial camera so
// the first frame matches the imported framing, then mouse drag/wheel update it
// for interactive viewpoint control shared by both render modes.

import { lookAt4, multiply4, orthographic4, type Mat4, type Vec3 } from './transforms.ts';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export interface OrbitCameraOptions {
  target: Vec3;
  distance: number;
  /** Rotation around +Y, radians. */
  yaw: number;
  /** Elevation above the horizon, radians. */
  pitch: number;
  fovY: number;
  aspect: number;
  near: number;
  far: number;
}

/** Spherical-orbit camera; eye is derived from target + yaw/pitch/distance. */
export class OrbitCamera {
  target: [number, number, number];
  distance: number;
  yaw: number;
  pitch: number;
  fovY: number;
  aspect: number;
  near: number;
  far: number;

  constructor(opts: OrbitCameraOptions) {
    this.target = [opts.target[0], opts.target[1], opts.target[2]];
    this.distance = opts.distance;
    this.yaw = opts.yaw;
    this.pitch = clamp(opts.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.fovY = opts.fovY;
    this.aspect = opts.aspect;
    this.near = opts.near;
    this.far = opts.far;
  }

  /** Seed the orbit from an initial eye/target pair so framing is preserved. */
  static fromEyeTarget(
    eye: Vec3,
    target: Vec3,
    aspect: number,
    fovY = Math.PI / 3,
    near = 0.001,
    far = 10000,
  ): OrbitCamera {
    const dx = eye[0] - target[0];
    const dy = eye[1] - target[1];
    const dz = eye[2] - target[2];
    const distance = Math.hypot(dx, dy, dz) || 1;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.asin(clamp(dy / distance, -1, 1));
    return new OrbitCamera({ target, distance, yaw, pitch, fovY, aspect, near, far });
  }

  get eye(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  view(): Mat4 {
    return lookAt4(this.eye, this.target, [0, 1, 0]);
  }

  viewProj(): Mat4 {
    // Orthographic framing: half-extents derived from distance/fovY so the
    // on-screen scale matches the former perspective at the target plane, and
    // dolly (distance) still zooms while pan stays pixel-accurate.
    const halfH = this.distance * Math.tan(this.fovY / 2);
    const halfW = halfH * this.aspect;
    return multiply4(orthographic4(-halfW, halfW, -halfH, halfH, this.near, this.far), this.view());
  }

  /** Rotate the viewpoint; deltas are in radians. */
  orbit(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Zoom by scaling the orbit radius (factor > 1 moves away). */
  dolly(factor: number): void {
    this.distance = clamp(this.distance * factor, this.near * 2, this.far * 0.9);
  }

  /** Slide the target in the camera plane; deltas are in pixels. */
  pan(dxPixels: number, dyPixels: number, viewportHeight: number): void {
    const eye = this.eye;
    const fx = this.target[0] - eye[0];
    const fy = this.target[1] - eye[1];
    const fz = this.target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    const f: Vec3 = [fx / fl, fy / fl, fz / fl];
    // right = normalize(f x up), camUp = right x f.
    let rx = -f[2];
    let ry = 0;
    let rz = f[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * f[2] - rz * f[1];
    const uy = rz * f[0] - rx * f[2];
    const uz = rx * f[1] - ry * f[0];
    // World units per pixel at the target depth.
    const scale = (2 * this.distance * Math.tan(this.fovY / 2)) / viewportHeight;
    const mx = (-dxPixels * rx + dyPixels * ux) * scale;
    const my = (-dxPixels * ry + dyPixels * uy) * scale;
    const mz = (-dxPixels * rz + dyPixels * uz) * scale;
    this.target[0] += mx;
    this.target[1] += my;
    this.target[2] += mz;
  }
}

/**
 * Attach mouse controls to a canvas: left-drag orbits, right/middle-drag pans,
 * wheel dollies. `onChange` fires whenever the viewpoint moved so the caller can
 * re-upload the camera uniforms and (for path tracing) restart accumulation.
 * Returns a disposer that detaches every listener.
 */
export function attachOrbitControls(
  canvas: HTMLCanvasElement,
  camera: OrbitCamera,
  onChange: () => void,
): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'orbit' | 'pan' = 'orbit';

  const onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mode = e.button === 0 ? 'orbit' : 'pan';
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    e.preventDefault();
    const dx = e.clientX - previous.x;
    const dy = e.clientY - previous.y;
    const next = { x: e.clientX, y: e.clientY };
    const other = Array.from(pointers.entries()).find(([pointerId]) => pointerId !== e.pointerId)?.[1];
    pointers.set(e.pointerId, next);
    if (dx === 0 && dy === 0) return;
    if (e.pointerType === 'touch' && other) {
      const previousDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
      const distance = Math.hypot(next.x - other.x, next.y - other.y);
      if (previousDistance > 0 && distance > 0) camera.dolly(previousDistance / distance);
      camera.pan(dx / 2, dy / 2, canvas.clientHeight || canvas.height);
    } else if (e.pointerType === 'touch' || mode === 'orbit') camera.orbit(-dx * 0.005, dy * 0.005);
    else camera.pan(dx, dy, canvas.clientHeight || canvas.height);
    onChange();
  };
  const onPointerUp = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    camera.dolly(Math.exp(e.deltaY * 0.001));
    onChange();
  };
  const onContextMenu = (e: Event): void => e.preventDefault();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return () => {
    pointers.clear();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('lostpointercapture', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}
