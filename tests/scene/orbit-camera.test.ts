import { describe, expect, it, vi } from 'vitest';
import { OrbitCamera, attachOrbitControls } from '../../src/scene/orbit-camera.ts';
import { transformPoint } from '../../src/scene/transforms.ts';

describe('orbit camera clipping', () => {
  it('keeps close and distant geometry within the default depth range', () => {
    const camera = OrbitCamera.fromEyeTarget([0, 0, 5], [0, 0, 0], 1);
    for (const depth of [0.01, 1000, 9000]) {
      const projected = transformPoint(camera.viewProj(), [0, 0, 5 - depth]);
      expect(projected[2]).toBeGreaterThan(0);
      expect(projected[2]).toBeLessThan(1);
    }
  });

  it('allows closer and farther zoom without changing the orbit direction', () => {
    const camera = OrbitCamera.fromEyeTarget([0, 0, 5], [0, 0, 0], 1);
    camera.dolly(0.01);
    expect(camera.distance).toBeCloseTo(0.05);
    camera.dolly(20000);
    expect(camera.distance).toBeCloseTo(1000);
    expect(camera.yaw).toBe(0);
    expect(camera.pitch).toBe(0);
  });
});

function fixture(pointerType = 'touch') {
  const target = new EventTarget();
  const captured = new Set<number>();
  const canvas = Object.assign(target, {
    height: 512,
    clientHeight: 320,
    setPointerCapture: (pointerId: number) => captured.add(pointerId),
    hasPointerCapture: (pointerId: number) => captured.has(pointerId),
    releasePointerCapture: (pointerId: number) => captured.delete(pointerId),
  }) as unknown as HTMLCanvasElement;
  const camera = OrbitCamera.fromEyeTarget([0, 0, 5], [0, 0, 0], 1);
  const onChange = vi.fn();
  const detach = attachOrbitControls(canvas, camera, onChange);
  const pointer = (type: string, pointerId: number, clientX: number, clientY: number) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pointerId, clientX, clientY, pointerType, button: 0,
    });
    canvas.dispatchEvent(event);
    return event;
  };
  return { camera, onChange, detach, pointer, captured };
}

describe('orbit controls', () => {
  it('reverses vertical mouse drag while preserving horizontal orbit', () => {
    const { camera, pointer } = fixture('mouse');
    pointer('pointerdown', 1, 100, 100);
    pointer('pointermove', 1, 140, 120);
    expect(camera.yaw).toBeCloseTo(-0.2);
    expect(camera.pitch).toBeCloseTo(0.1);
    pointer('pointermove', 1, 100, 80);
    expect(camera.yaw).toBeCloseTo(0);
    expect(camera.pitch).toBeCloseTo(-0.1);
  });

  it('orbits with one finger and prevents native drag behavior', () => {
    const { camera, onChange, pointer } = fixture();
    expect(pointer('pointerdown', 1, 100, 100).defaultPrevented).toBe(true);
    expect(pointer('pointermove', 1, 140, 120).defaultPrevented).toBe(true);
    expect(camera.yaw).toBeCloseTo(-0.2);
    expect(camera.pitch).toBeCloseTo(0.1);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('pinches and pans with two fingers without rotating the camera', () => {
    const { camera, pointer } = fixture();
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointermove', 2, 250, 100);
    expect(camera.distance).toBeCloseTo(5 * 100 / 150);
    expect(camera.target[0]).not.toBe(0);
    expect(camera.yaw).toBe(0);
    expect(camera.pitch).toBe(0);
  });

  it('resumes one-finger orbit after cancelling the second touch', () => {
    const { camera, pointer, captured } = fixture();
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointercancel', 2, 200, 100);
    pointer('pointermove', 1, 120, 100);
    expect(camera.yaw).toBeCloseTo(-0.1);
    expect(captured.has(2)).toBe(false);
    pointer('pointerup', 1, 120, 100);
    pointer('pointermove', 1, 160, 100);
    expect(camera.yaw).toBeCloseTo(-0.1);
  });

  it('stops responding after capture loss or detaching controls', () => {
    const { camera, pointer, detach, onChange } = fixture();
    pointer('pointerdown', 1, 100, 100);
    pointer('lostpointercapture', 1, 100, 100);
    pointer('pointermove', 1, 120, 100);
    detach();
    pointer('pointerdown', 2, 100, 100);
    pointer('pointermove', 2, 120, 100);
    expect(camera.yaw).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});