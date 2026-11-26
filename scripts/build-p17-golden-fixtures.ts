// Regenerate the small, standard-node MaterialX/USD scenes used by P17 goldens.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runScript, ScriptLibrary, SCRIPT_LIBRARY_FILES, toXml } from '../src/materialx/script-api.ts';
import { ENGINE_SHADER_LIBRARY_XML } from '../src/materialx/engine-shaders.ts';
import { writeStageUsda, type StageObject } from '../src/materialx/script-scene.ts';

const libraryRoot = process.env['MX_LIB_ROOT'] ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\libraries';
const library = ScriptLibrary.fromXml([
  ...await Promise.all(SCRIPT_LIBRARY_FILES.map(file => readFile(join(libraryRoot, file), 'utf8'))),
  ENGINE_SHADER_LIBRARY_XML,
]);
const out = resolve('tests', 'golden', 'p17');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'ground.mtlx'), toXml(await runScript('ground = new StandardSurface(); ground.base_color = [0.25, 0.25, 0.25];', library), library));

for (const preset of ['Water', 'Lava', 'Fire', 'Smoke', 'Clouds', 'Ice', 'Mud', 'WetSand']) {
  const name = preset.replace(/[A-Z]/g, (letter, index) => `${index ? '-' : ''}${letter.toLowerCase()}`);
  const volume = ['Fire', 'Smoke', 'Clouds'].includes(preset);
  const plane = ['Water', 'Lava'].includes(preset);
  const cloud = preset === 'Clouds';
  const script = `material = new ${preset}();` + (preset === 'Smoke' ? ' material.density = 1.4; material.scale = 1.2;' : '');
  await writeFile(join(out, `${name}.mtlx`), toXml(await runScript(script, library), library));
  const object: StageObject = {
    name: 'Preset', className: volume ? 'Volume' : plane ? 'Plane' : 'Sphere', material: 'Preset',
    parameters: volume ? { width: cloud ? 12 : 3.2, height: cloud || preset === 'Smoke' ? 4.5 : 3.4, length: cloud ? 10 : 3.2 }
      : plane ? { width: 4, length: 4, resolution: 24 } : { radius: 1, resolution: 24 },
    translate: [0, cloud ? 5.75 : preset === 'Smoke' ? 2.25 : preset === 'Fire' ? 1.7 : plane ? 0.5 : 1, 0],
    rotate: [0, 0, 0], scale: [1, 1, 1], visible: true,
  };
  const floor: StageObject = { ...object, name: 'Ground', className: 'Plane', material: 'Ground',
    parameters: { width: cloud ? 20 : 8, length: cloud ? 20 : 8 }, translate: [0, 0, 0] };
  const camera = `
def Camera "GoldenCamera" {
    float focalLength = 25
    float horizontalAperture = 20.955
    float verticalAperture = 20.955
    double3 xformOp:translate = (${cloud ? '13, 8, 15' : volume ? '5, 4, 5' : '4, 3, 4'})
    float3 xformOp:rotateXYZ = (${cloud ? '-8, 41, 0' : '-20, 45, 0'})
    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ"]
}
`;
  await writeFile(join(out, `${name}.usda`), writeStageUsda([object, floor], [
    { prim: 'Preset', name: 'material', assetPath: `./${name}.mtlx` },
    { prim: 'Ground', name: 'material', assetPath: './ground.mtlx' },
  ]) + camera);
  console.log(`P17 golden fixture: ${name}`);
}
