import { describe, expect, it } from 'vitest';
import { decodeProject, encodeProject, projectCamera, restoreCamera, type Project } from '../src/project.ts';
import { OrbitCamera } from '../src/scene/orbit-camera.ts';
import { importUsdaLayer } from '../src/render/usd-scene-assets.ts';

function project(): Project {
  const orbit = OrbitCamera.fromEyeTarget([3, 4, 5], [0, 0, 0], 1);
  orbit.distance = 2;
  return {
    format: 'materialx-webgpu-project', version: 1, script: 'ball = new Sphere();',
    stage: { usda: '#usda 1.0\ndef Xform "World" { def Sphere "ball" {} }', materials: [] },
    overrides: [], materials: [],
    scene: { time: 4, camera: projectCamera(orbit), transforms: [['/World/ball', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1]]],
      visibility: [['/World/ball', false]], lights: [] },
    settings: { backend: 'pathtracing', rasterQuality: 'reference', depth: 8, denoise: true, adaptive: true,
      view: 'normal', limits: { stopOnConvergence: true, timeBudgetSeconds: 30, targetRelativeError: 0.1 },
      environmentEnabled: true, paused: true, exposure: 2, tonemap: 'reinhard', temporalHistory: 0 },
    shaders: { image: { exposure: 1, contrast: 1, saturation: 1, vignette: 0 } },
    resolution: 512, memoryBudget: 1048576, objectPath: '/World/ball',
  };
}

describe('single-file project', () => {
  it('round-trips editable stage, script, scene overrides, camera and render settings', async () => {
    const original = project();
    const restored = decodeProject(encodeProject(original));
    expect(restored).toEqual(original);
    const imported = await importUsdaLayer('mem:/scene.usda', restored.stage.usda, new Map(restored.stage.materials));
    expect(imported.scene.prims.has('/World/ball')).toBe(true);
    const camera = restoreCamera(restored.scene.camera, 1);
    expect(camera.eye).toEqual(original.scene.camera.eye);
    expect(camera.distance).toBe(2);
    expect(camera.projection).toBe('orthographic');
  });

  it('accepts embedded MaterialX references but rejects missing assets and textures', () => {
    const value = project();
    value.stage.usda += '\ndef Material "M" (\n    prepend references = @./M.mtlx@</MaterialX/Materials/M>\n) {}';
    value.stage.materials.push(['./M.mtlx', '<materialx><surfacematerial name="M" /></materialx>']);
    expect(decodeProject(encodeProject(value)).stage.materials).toEqual(value.stage.materials);
    value.stage.materials = [];
    expect(() => encodeProject(value)).toThrow('dépendance USD');
    value.stage.materials = [['./M.mtlx', '<materialx><input name="file" type="filename" value="texture.png"/></materialx>']];
    expect(() => encodeProject(value)).toThrow('dépendances MaterialX');
    value.stage.materials = [['./M.mtlx', '<materialx><xi:include href="other.mtlx"/></materialx>']];
    expect(() => encodeProject(value)).toThrow('dépendances MaterialX');
    value.stage.materials = [['./M.mtlx', '<materialx/>']];
    expect(() => encodeProject({ ...value, stage: { ...value.stage, usda: 'asset texture = @./M.mtlx@' } })).toThrow('dépendance USD');
    value.overrides = [['/World/ball', { materialName: 'M', xml: '<materialx><image><input type="filename" value="map.png"/></image></materialx>' }]];
    expect(() => encodeProject(value)).toThrow('dépendances MaterialX');
  });

  it('rejects unknown versions, malformed data and runtime objects', () => {
    expect(() => decodeProject('{')).toThrow('JSON invalide');
    expect(() => decodeProject(JSON.stringify({ ...project(), version: 2 }))).toThrow('version');
    expect(() => decodeProject(JSON.stringify({ ...project(), scene: { ...project().scene, transforms: [['p', [1]]] } }))).toThrow('scène invalides');
    expect(() => decodeProject(JSON.stringify({ ...project(), materials: [['p', { version: 1, graph: { nodes: [{ id: 'a', inputs: [null] }], terminals: [] }, surface: { inputs: [] }, parameters: [] }]] }))).toThrow();
    expect(() => encodeProject({ ...project(), shaders: { image: new Map() as never } })).toThrow('runtime');
    expect(() => encodeProject({ ...project(), scene: { ...project().scene, time: NaN } })).toThrow('non fini');
  });
});
