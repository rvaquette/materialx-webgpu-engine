import { writeFileSync } from 'node:fs';
import { Mesh, SphereGeometry } from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';

const geometry = new SphereGeometry(1, 96, 48).translate(1, 0, -1);
const positions = geometry.getAttribute('position');
const normals = geometry.getAttribute('normal');
let maxNormalError = 0;
for (let vertex = 0; vertex < positions.count; vertex++) {
  const radial = [positions.getX(vertex) - 1, positions.getY(vertex), positions.getZ(vertex) + 1];
  const length = Math.hypot(...radial);
  maxNormalError = Math.max(maxNormalError, Math.hypot(
    normals.getX(vertex) - radial[0] / length,
    normals.getY(vertex) - radial[1] / length,
    normals.getZ(vertex) - radial[2] / length,
  ));
}
if (maxNormalError > 1e-6) throw new Error('Lama sphere normals are not radial.');
geometry.computeBoundingBox();
const mesh = new Mesh(geometry);
mesh.name = 'LamaSphere';
const output = new URL('../scenes/lama/sphere-smooth.obj', import.meta.url);
writeFileSync(output, new OBJExporter().parse(mesh));
console.log(JSON.stringify({ file: output.pathname, triangles: geometry.index.count / 3,
  bounds: geometry.boundingBox, maxNormalError }));
geometry.dispose();