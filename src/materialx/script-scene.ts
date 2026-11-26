// Scene objects created by material scripts (`ball = new Sphere(); ball.radius = 0.5;`) and the
// USD stage they form. The stage is the scene the viewer renders and the file `save("x.usda")`
// writes: UsdGeom implicit gprims where USD has one (tessellated by src/scene/primitives.ts),
// meshes otherwise, bound to MaterialX documents written next to the layer.
import {
  primitiveMesh, type PrimitiveAxis, type PrimitiveKind, MIN_RESOLUTION, MAX_RESOLUTION,
  DEFAULT_ADAPTIVE_VERTEX_BUDGET, MAX_ADAPTIVE_VERTEX_BUDGET,
} from '../scene/primitives.ts';
import type { RawMesh } from '../geometry/prepare.ts';
import type { ScriptNodeDef, ScriptPortDef } from './script-api.ts';

export type PrimitiveParameter =
  | 'radius' | 'minorRadius' | 'size' | 'height' | 'width' | 'length' | 'axis' | 'resolution'
  | 'maxEdgeLength' | 'maxScreenEdgeLength' | 'vertexBudget';

export interface ScriptPrimitive {
  kind: PrimitiveKind;
  /** USD schema written for it; `Mesh` stores the tessellation itself. */
  usdType: 'Sphere' | 'Cube' | 'Cylinder' | 'Cone' | 'Capsule' | 'Plane' | 'Mesh';
  doc: string;
  /** Shape parameters and their defaults (lengths in scene units). */
  defaults: Readonly<Partial<Record<PrimitiveParameter, number | PrimitiveAxis>>>;
}

/** Primitive classes of scripts, by class name. */
export const SCRIPT_PRIMITIVES: Readonly<Record<string, ScriptPrimitive>> = {
  Sphere: { kind: 'sphere', usdType: 'Sphere', doc: 'Sphère centrée sur l’origine', defaults: { radius: 0.5, resolution: 48 } },
  Cube: { kind: 'cube', usdType: 'Cube', doc: 'Cube centré sur l’origine', defaults: { size: 1, resolution: 1 } },
  Cylinder: { kind: 'cylinder', usdType: 'Cylinder', doc: 'Cylindre fermé, d’axe axis', defaults: { radius: 0.5, height: 1, axis: 'Y', resolution: 48 } },
  Cone: { kind: 'cone', usdType: 'Cone', doc: 'Cône, sommet vers +axis', defaults: { radius: 0.5, height: 1, axis: 'Y', resolution: 48 } },
  Capsule: { kind: 'capsule', usdType: 'Capsule', doc: 'Capsule : cylindre de hauteur height terminé par deux demi-sphères', defaults: { radius: 0.25, height: 0.5, axis: 'Y', resolution: 48 } },
  Torus: { kind: 'torus', usdType: 'Mesh', doc: 'Tore de rayon radius et d’épaisseur minorRadius', defaults: { radius: 0.5, minorRadius: 0.15, axis: 'Y', resolution: 48 } },
  Plane: {
    kind: 'plane', usdType: 'Plane', doc: 'Plan rectangulaire ; maxEdgeLength ou maxScreenEdgeLength adapte la grille au displacement',
    defaults: {
      width: 1, length: 1, axis: 'Y', resolution: 1,
      maxEdgeLength: 0, maxScreenEdgeLength: 0, vertexBudget: DEFAULT_ADAPTIVE_VERTEX_BUDGET,
    },
  },
  Disk: { kind: 'disk', usdType: 'Mesh', doc: 'Disque de normale axis', defaults: { radius: 0.5, axis: 'Y', resolution: 48 } },
};

export type BooleanOperation = 'union' | 'difference' | 'intersection';

export const SCRIPT_BOOLEAN_OPERATIONS: Readonly<Record<string, BooleanOperation>> = {
  Union: 'union',
  Difference: 'difference',
  Intersection: 'intersection',
};

const PARAMETER_DOCS: Readonly<Record<PrimitiveParameter, string>> = {
  radius: 'Rayon', minorRadius: 'Rayon du tube', size: 'Longueur d’arête', height: 'Hauteur', width: 'Largeur', length: 'Longueur',
  axis: 'Axe : "X", "Y" ou "Z"', resolution: 'Segments autour de l’axe, ou subdivisions par côté',
  maxEdgeLength: 'Longueur maximale d’arête en espace objet ; 0 désactive la subdivision adaptative',
  maxScreenEdgeLength: 'Longueur maximale d’arête projetée en pixels ; 0 désactive la subdivision adaptative caméra',
  vertexBudget: 'Budget maximal de sommets pour la subdivision adaptative',
};

/** Properties shared by every primitive. */
export const OBJECT_PROPERTIES: readonly ScriptPortDef[] = [
  { name: 'translate', type: 'vector3', default: [0, 0, 0], doc: 'Position' },
  { name: 'rotate', type: 'vector3', default: [0, 0, 0], doc: 'Rotations en degrés autour de X, Y puis Z' },
  { name: 'scale', type: 'vector3', default: [1, 1, 1], doc: 'Échelle (un nombre ou trois)' },
  { name: 'visible', type: 'boolean', default: true, doc: 'Visibilité' },
  { name: 'material', type: 'material', doc: 'Matériau : surface shader, nœud material ou chemin .mtlx' },
  { name: 'deform', type: 'function', doc: 'Déformation : (position, uv, normale) => [x, y, z] appliquée à chaque sommet' },
];

const BOOLEAN_OBJECT_PROPERTIES = OBJECT_PROPERTIES.filter(property => property.name !== 'deform');

/** Script NodeDef-like description of a primitive class, for the editor (completions, hover, value helpers). */
export function primitiveScriptDef(className: string): ScriptNodeDef | undefined {
  const primitive = SCRIPT_PRIMITIVES[className];
  if (!primitive) return undefined;
  const parameters = Object.entries(primitive.defaults).map(([name, value]): ScriptPortDef => {
    const parameter = name as PrimitiveParameter;
    if (parameter === 'axis') return { name, type: 'string', default: value, enum: ['X', 'Y', 'Z'], doc: PARAMETER_DOCS.axis };
    if (parameter === 'resolution') {
      return { name, type: 'integer', default: value, min: MIN_RESOLUTION[primitive.kind], max: MAX_RESOLUTION, doc: PARAMETER_DOCS.resolution };
    }
    if (parameter === 'vertexBudget') {
      return { name, type: 'integer', default: value, min: 4, max: MAX_ADAPTIVE_VERTEX_BUDGET, doc: PARAMETER_DOCS.vertexBudget };
    }
    if (parameter === 'maxEdgeLength') return { name, type: 'float', default: value, min: 0, doc: PARAMETER_DOCS.maxEdgeLength };
    if (parameter === 'maxScreenEdgeLength') return { name, type: 'float', default: value, min: 0, doc: PARAMETER_DOCS.maxScreenEdgeLength };
    return { name, type: 'float', default: value, min: 0, doc: PARAMETER_DOCS[parameter] };
  });
  return { name: `primitive ${className}`, category: className, className, doc: primitive.doc, inputs: [...parameters, ...OBJECT_PROPERTIES], outputs: [] };
}

export function booleanScriptDef(className: string): ScriptNodeDef | undefined {
  const operation = SCRIPT_BOOLEAN_OPERATIONS[className];
  if (!operation) return undefined;
  return {
    name: `boolean ${className}`,
    category: className,
    className,
    doc: `${operation[0]!.toUpperCase()}${operation.slice(1)} de deux maillages fermés.`,
    inputs: [
      { name: 'base', type: 'object', doc: 'Opérande de base' },
      { name: 'tool', type: 'object', doc: 'Opérande outil' },
      ...BOOLEAN_OBJECT_PROPERTIES,
    ],
    outputs: [],
  };
}

/** One primitive of the stage, as written to USD. */
export interface StageObject {
  /** Prim name under /World. */
  name: string;
  className: string;
  parameters: Readonly<Partial<Record<PrimitiveParameter, number | PrimitiveAxis>>>;
  translate: readonly number[];
  rotate: readonly number[];
  scale: readonly number[];
  visible: boolean;
  /** Prim name of its material under /World/Looks. */
  material?: string;
  /** Tessellation replacing the shape (a deformed primitive): written as a Mesh. */
  mesh?: RawMesh;
  booleanOperation?: BooleanOperation;
  base?: string;
  tool?: string;
}

export interface StageMaterial {
  /** Prim name under /World/Looks. */
  prim: string;
  /** `surfacematerial` name in the document. */
  name: string;
  /** Document path: `./name.mtlx` for documents written with the layer, or a URL. */
  assetPath: string;
}

const number = (value: number): string => {
  const text = String(Number(value.toPrecision(7)));
  return text === '-0' ? '0' : text;
};
const tuple = (values: readonly number[]): string => `(${values.map(number).join(', ')})`;
const tuples = (values: readonly number[], size: number): string => {
  const items: string[] = [];
  for (let i = 0; i < values.length; i += size) items.push(tuple(values.slice(i, i + size)));
  return `[${items.join(', ')}]`;
};

/** Shape of a stage object, with its defaults filled in. */
export function stageObjectShape(object: StageObject): Parameters<typeof primitiveMesh>[0] {
  const primitive = SCRIPT_PRIMITIVES[object.className]!;
  return { kind: primitive.kind, ...primitive.defaults, ...object.parameters } as Parameters<typeof primitiveMesh>[0];
}

/**
 * USDA layer of the stage. Without `transforms`, placement and visibility are left out: two
 * stages with the same such text differ only by what the viewer can change without a reload.
 */
export function writeStageUsda(objects: readonly StageObject[], materials: readonly StageMaterial[], options: { transforms?: boolean } = {}): string {
  const transforms = options.transforms ?? true;
  const lines = [
    '#usda 1.0',
    '(',
    '    defaultPrim = "World"',
    '    metersPerUnit = 1',
    '    upAxis = "Y"',
    '    doc = "Scene created by a MaterialX script"',
    ')',
    '',
    'def Xform "World"',
    '{',
  ];
  if (materials.length) {
    lines.push('    def Scope "Looks"', '    {');
    for (const material of materials) {
      lines.push(
        `        def Material "${material.prim}" (`,
        `            prepend references = @${material.assetPath}@</MaterialX/Materials/${material.name}>`,
        '        )',
        '        {',
        '        }',
      );
    }
    lines.push('    }');
  }
  for (const object of objects) {
    const primitive = SCRIPT_PRIMITIVES[object.className];
    const shape = primitive ? stageObjectShape(object) : undefined;
    const mesh = object.mesh ?? (primitive?.usdType === 'Mesh' && shape ? primitiveMesh(shape) : undefined);
    if (!primitive && !object.booleanOperation) throw new Error(`Unknown scripted stage object "${object.className}".`);
    if (object.booleanOperation && !mesh) throw new Error(`Boolean object "${object.name}" has not been evaluated.`);
    const usdType = mesh ? 'Mesh' : primitive!.usdType;
    lines.push('', `    def ${usdType} "${object.name}"${object.material ? ' (' : ''}`);
    if (object.material) lines.push('        prepend apiSchemas = ["MaterialBindingAPI"]', '    )');
    lines.push('    {');
    const body: string[] = [];
    if (mesh) {
      body.push(
        `custom token engine:primitive = "${shape?.kind ?? 'boolean'}"`,
        ...(shape ? Object.entries(shape).filter(([name]) => name !== 'kind')
          .map(([name, value]) => typeof value === 'number'
            ? `custom ${name === 'resolution' || name === 'vertexBudget' ? 'int' : 'double'} engine:primitive:${name} = ${number(value)}`
            : `custom token engine:primitive:${name} = "${value}"`) : []),
        'uniform token subdivisionScheme = "none"',
        `int[] faceVertexCounts = [${mesh.faceVertexCounts.join(', ')}]`,
        `int[] faceVertexIndices = [${mesh.faceVertexIndices.join(', ')}]`,
        `point3f[] points = ${tuples(mesh.points, 3)}`,
      );
      if (mesh.normals) body.push(`normal3f[] normals = ${tuples(mesh.normals.values, 3)} (`, '    interpolation = "vertex"', ')');
      const st = mesh.primvars?.find(attribute => attribute.name === 'st');
      if (st) body.push(`texCoord2f[] primvars:st = ${tuples(st.values, 2)} (`, '    interpolation = "vertex"', ')');
    } else {
      for (const [name, value] of Object.entries(shape ?? {})) {
        if (name === 'kind') continue;
        if (name === 'axis') body.push(`uniform token axis = "${value}"`);
        else if (name === 'resolution') body.push(`custom int engine:resolution = ${value}`);
        else if (name === 'maxEdgeLength') body.push(`custom double engine:maxEdgeLength = ${number(value as number)}`);
        else if (name === 'maxScreenEdgeLength') body.push(`custom double engine:maxScreenEdgeLength = ${number(value as number)}`);
        else if (name === 'vertexBudget') body.push(`custom int engine:vertexBudget = ${value}`);
        else body.push(`double ${name} = ${number(value as number)}`);
      }
    }
    if (transforms) {
      const ops: string[] = [];
      if (object.translate.some(value => value !== 0)) {
        body.push(`double3 xformOp:translate = ${tuple(object.translate)}`);
        ops.push('xformOp:translate');
      }
      // rotate = [x, y, z] turns about X, then Y, then Z: the op order lists Z first.
      for (const [axis, index] of [['Z', 2], ['Y', 1], ['X', 0]] as const) {
        if (object.rotate[index] === 0) continue;
        body.push(`float xformOp:rotate${axis} = ${number(object.rotate[index]!)}`);
        ops.push(`xformOp:rotate${axis}`);
      }
      if (object.scale.some(value => value !== 1)) {
        body.push(`float3 xformOp:scale = ${tuple(object.scale)}`);
        ops.push('xformOp:scale');
      }
      if (ops.length) body.push(`uniform token[] xformOpOrder = [${ops.map(op => `"${op}"`).join(', ')}]`);
      if (!object.visible) body.push('token visibility = "invisible"');
    }
    if (object.material) body.push(`rel material:binding = </World/Looks/${object.material}>`);
    lines.push(...body.map(line => `        ${line}`), '    }');
  }
  lines.push('}', '');
  return lines.join('\n');
}
