import { describe, expect, it } from 'vitest';
import { importUsdStage } from '../../src/usd/importer.ts';

const read = (layers: Record<string, string>) => ({ read: async (uri: string) => layers[uri] ?? '#usda 1.0' });

const ANIMATED = `#usda 1.0
(
    startTimeCode = 1
    endTimeCode = 48
    timeCodesPerSecond = 24
)
def Xform "World"
{
    def Mesh "Box"
    {
        double3 xformOp:translate = (0, 0, 0)
        double3 xformOp:translate.timeSamples = {
            1: (0, 0, 0),
            48: (4, 0, 0),
        }
        float xformOp:rotateY.timeSamples = { 1: 0, 24: 90, }
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateY"]
        float inputs:intensity.timeSamples = { 0: 1, 10: None }
    }
}
`;

describe('USD time samples', () => {
  it('reads stage time metadata and time-sampled attributes and xform ops', async () => {
    const scene = await importUsdStage('a.usda', { reader: read({ 'a.usda': ANIMATED }) });
    expect(scene.stage).toMatchObject({ startTimeCode: 1, endTimeCode: 48, timeCodesPerSecond: 24 });
    const box = scene.prims.get('/World/Box')!;
    const translate = box.xformOps.find(op => op.op === 'xformOp:translate')!;
    expect(translate.value).toEqual([0, 0, 0]);
    expect(translate.timeSamples).toEqual([{ time: 1, value: [0, 0, 0] }, { time: 48, value: [4, 0, 0] }]);
    expect(box.xformOps.find(op => op.op === 'xformOp:rotateY')!.timeSamples).toEqual([{ time: 1, value: 0 }, { time: 24, value: 90 }]);
    expect(box.attributes.get('inputs:intensity')!.timeSamples).toEqual([{ time: 0, value: 1 }, { time: 10, value: null }]);
  });
});

const VARIANTS = `#usda 1.0
def Xform "Car" (
    variants = {
        string color = "red"
    }
    prepend variantSets = "color"
)
{
    float local = 1
    variantSet "color" = {
        "red" {
            color3f inputs:tint = (1, 0, 0)
            float local = 5
            def Mesh "Badge" {}
        }
        "blue" (
            doc = "blue paint"
        ) {
            color3f inputs:tint = (0, 0, 1)
        }
    }
}
`;

describe('USD variant sets', () => {
  it('composes the authored selection as weaker than local opinions and records the sets', async () => {
    const scene = await importUsdStage('v.usda', { reader: read({ 'v.usda': VARIANTS }) });
    const car = scene.prims.get('/Car')!;
    expect(car.attributes.get('inputs:tint')!.value).toEqual([1, 0, 0]);
    expect(car.attributes.get('local')!.value).toBe(1);
    expect(scene.prims.has('/Car/Badge')).toBe(true);
    expect(car.variantSets?.get('color')).toEqual({ variants: ['red', 'blue'], selection: 'red' });
  });

  it('applies a selection override and lets a stronger layer select a weaker layer\'s variant', async () => {
    const overridden = await importUsdStage('v.usda', {
      reader: read({ 'v.usda': VARIANTS }),
      variantSelections: new Map([['/Car', new Map([['color', 'blue']])]]),
    });
    expect(overridden.prims.get('/Car')!.attributes.get('inputs:tint')!.value).toEqual([0, 0, 1]);
    expect(overridden.prims.has('/Car/Badge')).toBe(false);
    const root = `#usda 1.0
(
    subLayers = [@v.usda@]
)
over "Car" (
    variants = {
        string color = "blue"
    }
)
{
}
`;
    const layered = await importUsdStage('root.usda', { reader: read({ 'root.usda': root, 'v.usda': VARIANTS }) });
    expect(layered.prims.get('/Car')!.attributes.get('inputs:tint')!.value).toEqual([0, 0, 1]);
  });
});
