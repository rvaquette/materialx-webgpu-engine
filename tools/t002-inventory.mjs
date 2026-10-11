// T002 inventory generator.
// Parses every .mtlx under the MaterialX Examples corpus with the Core WASM,
// collecting the nodes each example actually declares/uses, and resolves their
// NodeDefs/implementations against a precomputed index of the standard
// libraries. Emits a JSON report used when authoring docs/scene-inventory.md and
// docs/materialx-node-coverage.md. Evidence only; no engine code depends on it.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const WASM = 'D:/WebGL2/MaterialX/MaterialX-rva/javascript/build/installed/JavaScript/MaterialX/JsMaterialXCore.js';
const EXAMPLES = 'D:/WebGL2/MaterialX/MaterialX-rva/resources/Materials/Examples';
const LIBRARIES = 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';
const OUT = join(process.cwd(), 'docs', 'generated', 't002-inventory.json');

function walk(dir, ext, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, acc);
    else if (p.toLowerCase().endsWith(ext)) acc.push(p);
  }
  return acc;
}

function vecToArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  const out = [];
  const n = typeof v.size === 'function' ? v.size() : 0;
  for (let i = 0; i < n; i++) out.push(v.get(i));
  return out;
}

async function main() {
  const factory = require(WASM).default;
  const mx = await factory();

  // Load the standard libraries into a single library document.
  const libDoc = mx.createDocument();
  const libFiles = walk(LIBRARIES, '.mtlx');
  const roNoInc = new mx.XmlReadOptions();
  roNoInc.readXIncludes = false;
  let libLoaded = 0;
  for (const f of libFiles) {
    try {
      const tmp = mx.createDocument();
      await mx.readFromXmlString(tmp, readFileSync(f, 'utf8'), LIBRARIES, roNoInc);
      libDoc.importLibrary(tmp);
      tmp.delete();
      libLoaded++;
    } catch { /* non-standalone fragment */ }
  }

  // Detect implementation kind per nodedef via a deterministic raw scan:
  // a <nodegraph nodedef="X"> expands to a subgraph; an <implementation nodedef="X">
  // is a source-code leaf that the engine must lower to WGSL directly.
  const files = walk(EXAMPLES, '.mtlx').sort();
  const implKindByDef = new Map(); // nodedefName -> 'nodegraph' | 'sourcecode'
  const defToGraph = new Map();    // nodedefName -> implementing nodegraph name
  for (const f of [...libFiles, ...files]) {
    const t = readFileSync(f, 'utf8');
    // A <nodegraph nodedef="X"> expands to a subgraph.
    for (const mm of t.matchAll(/<nodegraph\b([^>]*)>/g)) {
      const attrs = mm[1];
      const nd = /\bnodedef="([^"]+)"/.exec(attrs)?.[1];
      const nm = /\bname="([^"]+)"/.exec(attrs)?.[1];
      if (nd) { implKindByDef.set(nd, 'nodegraph'); if (nm) defToGraph.set(nd, nm); }
    }
    // An <implementation> with a nodegraph="..." attribute also redirects to a
    // subgraph (e.g. standard_surface); only a file/function/sourcecode
    // implementation is a true source-code leaf.
    for (const mm of t.matchAll(/<implementation\b([^>]*)>/g)) {
      const attrs = mm[1];
      const nd = /\bnodedef="([^"]+)"/.exec(attrs)?.[1];
      if (!nd) continue;
      const ng = /\bnodegraph="([^"]+)"/.exec(attrs)?.[1];
      if (ng) { implKindByDef.set(nd, 'nodegraph'); defToGraph.set(nd, ng); }
      else if (!implKindByDef.has(nd)) implKindByDef.set(nd, 'sourcecode');
    }
  }

  // Map each implementing nodegraph name to the set of node categories it contains.
  const ngCatsByName = new Map();
  const indexNodeGraphCats = (doc) => {
    for (const ng of vecToArray(doc.getNodeGraphs())) {
      const cats = new Set(vecToArray(ng.getNodes()).map((n) => n.getCategory()));
      ngCatsByName.set(ng.getName(), cats);
    }
  };
  indexNodeGraphCats(libDoc);

  // Index nodedefs by category (stdlib, plus any defined inside examples).
  const defsByCategory = new Map(); // category -> [{name,type,group,implKind,source}]
  const indexNodeDefs = (doc, source) => {
    for (const nd of vecToArray(doc.getNodeDefs())) {
      let cat = '', type = '', group = '';
      try { cat = nd.getNodeString(); } catch {}
      try { type = nd.getType(); } catch {}
      try { group = nd.getNodeGroup(); } catch {}
      if (!cat) continue;
      const name = nd.getName();
      if (!defsByCategory.has(cat)) defsByCategory.set(cat, []);
      if (defsByCategory.get(cat).some((d) => d.name === name)) continue;
      defsByCategory.get(cat).push({ name, type, group, implKind: implKindByDef.get(name) || 'sourcecode', source });
    }
  };
  indexNodeDefs(libDoc, 'stdlib');

  const resolveDef = (cat, type) => {
    const defs = defsByCategory.get(cat);
    if (!defs || defs.length === 0) return null;
    return defs.find((d) => d.type === type)
      || defs.find((d) => d.type === 'multioutput')
      || defs[0];
  };

  const categories = new Map();
  const perFile = [];
  const unresolved = new Set();

  const bump = (cat, type, file, def) => {
    let e = categories.get(cat);
    if (!e) {
      e = { types: new Set(), files: new Set(), count: 0, group: def?.group || '', implKind: def?.implKind || 'unresolved', nodeDef: def?.name || '', source: def?.source || '' };
      categories.set(cat, e);
    }
    if (type) e.types.add(type);
    e.files.add(file);
    e.count++;
    if (!e.nodeDef && def) { e.nodeDef = def.name; e.group = def.group; e.implKind = def.implKind; e.source = def.source; }
  };

  for (const file of files) {
    const rel = relative(EXAMPLES, file).split(sep).join('/');
    const content = readFileSync(file, 'utf8');
    const doc = mx.createDocument();
    const ro = new mx.XmlReadOptions();
    ro.readXIncludes = false;
    await mx.readFromXmlString(doc, content, EXAMPLES, ro);
    // NOTE: do NOT importLibrary -- we want only the nodes this example declares.
    indexNodeDefs(doc, 'corpus'); // register example-local nodedefs (e.g. simple_hair)
    indexNodeGraphCats(doc);      // register example-local nodegraph expansions

    const fileRec = { file: rel, materials: [], shaders: [], nodeCount: 0, categories: [], textures: [], nodegraphs: [] };

    const own = [];
    for (const n of vecToArray(doc.getNodes())) own.push(n);
    for (const ng of vecToArray(doc.getNodeGraphs())) {
      fileRec.nodegraphs.push(ng.getName());
      for (const n of vecToArray(ng.getNodes())) own.push(n);
    }

    const fileCats = new Set();
    for (const node of own) {
      const cat = node.getCategory();
      let type = ''; try { type = node.getType(); } catch {}
      const def = resolveDef(cat, type);
      if (!def) unresolved.add(cat);
      bump(cat, type, rel, def);
      fileCats.add(cat);
      fileRec.nodeCount++;
      if (type === 'material') fileRec.materials.push(node.getName());
      if (['surfaceshader', 'volumeshader', 'displacementshader', 'lightshader'].includes(type))
        fileRec.shaders.push({ name: node.getName(), category: cat, type });
    }
    fileRec.categories = [...fileCats].sort();

    const texRe = /type="filename"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*type="filename"/g;
    let m; const seenTex = new Set();
    while ((m = texRe.exec(content))) {
      const v = m[1] || m[2];
      if (v && !seenTex.has(v)) { seenTex.add(v); fileRec.textures.push(v); }
    }

    perFile.push(fileRec);
    doc.delete();
  }

  const categoryList = [...categories.entries()]
    .map(([cat, e]) => ({
      category: cat,
      types: [...e.types].sort(),
      count: e.count,
      fileCount: e.files.size,
      group: e.group,
      implKind: e.implKind,
      nodeDef: e.nodeDef,
      source: e.source,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const byGroup = {};
  for (const c of categoryList) {
    const g = c.group || '(ungrouped)';
    (byGroup[g] ||= []).push(c.category);
  }

  // Transitive closure: every node category the engine must lower to WGSL to
  // render the corpus, obtained by expanding each nodegraph-backed node into the
  // categories of its implementing graph until only source-code leaves remain.
  const closure = new Map(); // category -> { implKind, direct }
  const expand = (cat) => {
    if (closure.has(cat)) return;
    const def = resolveDef(cat, '');
    const implKind = def?.implKind || 'unresolved';
    closure.set(cat, { implKind, direct: categories.has(cat) });
    if (implKind !== 'nodegraph') return;
    const ngName = def ? defToGraph.get(def.name) : undefined;
    const childCats = ngName ? ngCatsByName.get(ngName) : undefined;
    if (childCats) for (const cc of childCats) expand(cc);
  };
  for (const cat of categories.keys()) expand(cat);
  const closureList = [...closure.entries()]
    .map(([category, v]) => ({ category, implKind: v.implKind, directlyUsed: v.direct }))
    .sort((a, b) => a.category.localeCompare(b.category));
  const closureLeaves = closureList.filter((c) => c.implKind === 'sourcecode').map((c) => c.category);
  const report = {
    generatedAt: new Date().toISOString(),
    wasm: WASM,
    examplesRoot: EXAMPLES,
    librariesRoot: LIBRARIES,
    libraryFilesLoaded: libLoaded,
    libraryFilesTotal: libFiles.length,
    nodeDefsIndexed: [...defsByCategory.values()].reduce((a, v) => a + v.length, 0),
    fileCount: files.length,
    categoryCount: categoryList.length,
    unresolvedCategories: [...unresolved].sort(),
    byGroup,
    closureCategoryCount: closureList.length,
    closureLeafCount: closureLeaves.length,
    closure: closureList,
    categories: categoryList,
    files: perFile,
  };

  mkdirSync(join(process.cwd(), 'docs', 'generated'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('files=' + report.fileCount + ' categories=' + report.categoryCount +
    ' nodeDefsIndexed=' + report.nodeDefsIndexed + ' libLoaded=' + libLoaded + '/' + libFiles.length +
    ' unresolved=' + report.unresolvedCategories.length);
  console.log('closure=' + report.closureCategoryCount + ' leaves=' + report.closureLeafCount);
  console.log('unresolved: ' + (report.unresolvedCategories.join(', ') || '(none)'));
  console.log('groups: ' + Object.keys(byGroup).sort().join(', '));
  libDoc.delete();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
