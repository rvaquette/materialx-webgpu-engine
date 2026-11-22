import { describe, expect, it } from 'vitest';
import { evaluateSceneAt, sampleAt, sceneTimeline } from '../../src/scene/time.ts';
import { importUsdStage } from '../../src/usd/importer.ts';

describe('scene time evaluation', () => {
  it('interpolates numeric samples, holds discrete and blocked ones, and clamps outside the range', () => {
    const samples = [{ time: 0, value: [0, 0, 0] }, { time: 10, value: [10, 20, 0] }];
    expect(sampleAt('double3', samples, 2.5)).toEqual([2.5, 5, 0]);
    expect(sampleAt('double3', samples, -1)).toEqual([0, 0, 0]);
    expect(sampleAt('double3', samples, 99)).toEqual([10, 20, 0]);
    expect(sampleAt('int', [{ time: 0, value: 1 }, { time: 10, value: 5 }], 9)).toBe(1);
    expect(sampleAt('float', [{ time: 0, value: 1 }, { time: 10, value: null }], 5)).toBe(1);
    expect(sampleAt('float', [{ time: 0, value: 1 }, { time: 10, value: null }], 10)).toBeNull();
    expect(sampleAt('token', [], 0)).toBeUndefined();
  });

  it('interpolates quaternions on the unit sphere', () => {
    const q = sampleAt('quatf', [{ time: 0, value: [1, 0, 0, 0] }, { time: 1, value: [0, 0, 1, 0] }], 0.5) as number[];
    expect(q[0]).toBeCloseTo(Math.SQRT1_2);
    expect(q[2]).toBeCloseTo(Math.SQRT1_2);
  });

  it('resolves a stage at a time code without touching static prims', async () => {
    const text = `#usda 1.0
(
    startTimeCode = 0
    endTimeCode = 10
)
def Xform "Moving"
{
    double3 xformOp:translate.timeSamples = { 0: (0, 0, 0), 10: (10, 0, 0) }
    uniform token[] xformOpOrder = ["xformOp:translate"]
}
def Xform "Static"
{
}
`;
    const scene = await importUsdStage('s.usda', { reader: { read: async () => text } });
    expect(sceneTimeline(scene)).toEqual({ start: 0, end: 10, timeCodesPerSecond: 24, animated: true });
    const at = evaluateSceneAt(scene, 4);
    expect(at.prims.get('/Moving')!.xformOps[0]!.value).toEqual([4, 0, 0]);
    expect(at.prims.get('/Static')).toBe(scene.prims.get('/Static'));
    expect(evaluateSceneAt(at, 6).prims.get('/Moving')!.xformOps[0]!.value).toEqual([6, 0, 0]);
  });
});
