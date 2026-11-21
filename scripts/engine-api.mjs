// Public API report of the engine package: every export of the package entry
// points and every project type they reach, printed with expanded signatures.
// docs/engine-api.md is the frozen contract; scripts/engine-api.test.mjs fails
// when the report changes. `npm run api:engine` rewrites it after an intended
// change (see docs/ENGINE_API.md for the compatibility rules).
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
export const ENGINE_API_ENTRIES = { 'materialx-webgpu-engine': 'src/engine.ts', 'materialx-webgpu-engine/element': 'src/engine-element.ts' };
export const ENGINE_API_REPORT = join(root, 'docs', 'engine-api.md');

const FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature;

function compilerOptions() {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
}

export function engineApiReport() {
  const program = ts.createProgram(Object.values(ENGINE_API_ENTRIES).map(file => join(root, file)), compilerOptions());
  const checker = program.getTypeChecker();
  const source = join(root, 'src') + sep;
  const isProject = declaration => declaration.getSourceFile().fileName.replaceAll('/', sep).startsWith(source);
  const location = declaration => relative(root, declaration.getSourceFile().fileName).replaceAll(sep, '/');

  const queued = new Set();
  const pending = [];
  const enqueue = symbol => {
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol.declarations?.[0];
    if (!declaration || !isProject(declaration) || queued.has(symbol)) return;
    queued.add(symbol);
    pending.push(symbol);
  };
  const seenTypes = new Set();
  const visit = type => {
    if (!type || seenTypes.has(type)) return;
    seenTypes.add(type);
    if (type.aliasSymbol) {
      enqueue(type.aliasSymbol);
      type.aliasTypeArguments?.forEach(visit);
      return;
    }
    if (type.isUnionOrIntersection()) return type.types.forEach(visit);
    const symbol = type.getSymbol();
    if (symbol && symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.Enum)) {
      enqueue(symbol);
      if (type.objectFlags & ts.ObjectFlags.Reference) checker.getTypeArguments(type).forEach(visit);
      return;
    }
    if (type.objectFlags & ts.ObjectFlags.Reference) checker.getTypeArguments(type).forEach(visit);
    if (type.flags & ts.TypeFlags.Object) {
      for (const property of type.getProperties()) visit(checker.getTypeOfSymbol(property));
      for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) visitSignature(signature);
    }
  };
  const visitSignature = signature => {
    for (const parameter of signature.getParameters()) visit(checker.getTypeOfSymbol(parameter));
    visit(signature.getReturnType());
  };
  const typeText = (type, node) => { visit(type); return checker.typeToString(type, node, FORMAT); };
  const signatureText = (signature, node, arrow = true) => {
    visitSignature(signature);
    return checker.signatureToString(signature, node, arrow ? FORMAT : ts.TypeFormatFlags.NoTruncation, ts.SignatureKind.Call);
  };
  const isPrivate = declaration => ts.isPrivateIdentifier(declaration.name ?? {}) ||
    (ts.getCombinedModifierFlags(declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
  const isReadonly = (symbol, declaration) => ts.isGetAccessor(declaration)
    ? !symbol.declarations.some(ts.isSetAccessor)
    : (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0;

  /** Members of a class side or interface, in declaration order. */
  const members = (symbols, node, indent = '  ') => symbols.flatMap(member => {
    const declaration = member.declarations?.[0];
    if (!declaration || isPrivate(declaration) || member.name === 'prototype') return [];
    const type = checker.getTypeOfSymbolAtLocation(member, declaration);
    const optional = member.flags & ts.SymbolFlags.Optional ? '?' : '';
    const name = /^[A-Za-z_$][\w$]*$/.test(member.name) ? member.name : JSON.stringify(member.name);
    if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) {
      return type.getCallSignatures().map(signature => `${indent}${name}${optional}${signatureText(signature, node, false)};`);
    }
    return [`${indent}${isReadonly(member, declaration) ? 'readonly ' : ''}${name}${optional}: ${typeText(type, node)};`];
  });

  const print = (symbol, exportedAs) => {
    const declaration = symbol.declarations[0];
    const name = exportedAs ?? symbol.name;
    const header = `// ${location(declaration)}`;
    if (symbol.flags & ts.SymbolFlags.Class) {
      const instance = checker.getDeclaredTypeOfSymbol(symbol);
      const statics = checker.getTypeOfSymbolAtLocation(symbol, declaration).getProperties();
      const constructors = declaration.members.filter(ts.isConstructorDeclaration).filter(node => !isPrivate(node));
      return [header, `class ${name} {`,
        ...constructors.map(node => `  constructor${signatureText(checker.getSignatureFromDeclaration(node), declaration, false).replace(/: [^:]*$/, '')};`),
        ...members(statics, declaration).map(line => line.replace(/^ {2}/, '  static ')),
        ...members(instance.getProperties(), declaration), '}'].join('\n');
    }
    if (symbol.flags & ts.SymbolFlags.Interface) {
      const heritage = declaration.heritageClauses?.map(clause => ` ${clause.getText()}`).join('') ?? '';
      const typeParameters = declaration.typeParameters ? `<${declaration.typeParameters.map(node => node.getText()).join(', ')}>` : '';
      declaration.heritageClauses?.forEach(clause => clause.types.forEach(node => visit(checker.getTypeAtLocation(node))));
      const own = declaration.members.map(member => member.symbol ?? checker.getSymbolAtLocation(member.name)).filter(Boolean);
      return [header, `interface ${name}${typeParameters}${heritage} {`, ...members([...new Set(own)], declaration), '}'].join('\n');
    }
    if (symbol.flags & ts.SymbolFlags.TypeAlias) {
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      const typeParameters = declaration.typeParameters ? `<${declaration.typeParameters.map(node => node.getText()).join(', ')}>` : '';
      return `${header}\ntype ${name}${typeParameters} = ${typeText(type, declaration) === name ? declaration.type.getText() : checker.typeToString(type, declaration, FORMAT | ts.TypeFormatFlags.InTypeAlias)};`;
    }
    if (symbol.flags & ts.SymbolFlags.Function) {
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      return [header, ...type.getCallSignatures().map(signature => `function ${name}${signatureText(signature, declaration, false)};`)].join('\n');
    }
    if (symbol.flags & ts.SymbolFlags.Variable) {
      return `${header}\nconst ${name}: ${typeText(checker.getTypeOfSymbolAtLocation(symbol, declaration), declaration)};`;
    }
    throw new Error(`Unsupported public symbol ${name} (${location(declaration)}).`);
  };

  const sections = [];
  const exported = new Set();
  for (const [specifier, file] of Object.entries(ENGINE_API_ENTRIES)) {
    const module = checker.getSymbolAtLocation(program.getSourceFile(join(root, file)));
    const entries = checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name)).map(alias => {
      const symbol = alias.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(alias) : alias;
      exported.add(symbol);
      queued.add(symbol);
      return print(symbol, alias.name);
    });
    sections.push(`## \`${specifier}\`\n\n\`\`\`ts\n${entries.join('\n\n')}\n\`\`\``);
  }
  const internal = [];
  while (pending.length) {
    const symbol = pending.shift();
    if (!exported.has(symbol)) internal.push([symbol.name, location(symbol.declarations[0]), print(symbol)]);
  }
  internal.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  sections.push(`## Types reachable from the public API\n\nNot exported by name, but part of the contract through the signatures above.\n\n\`\`\`ts\n${internal.map(([, , text]) => text).join('\n\n')}\n\`\`\``);
  const body = sections.join('\n\n').replace(/\r\n/g, '\n');
  return `# Engine package API report\n\nGenerated by \`npm run api:engine\`; do not edit by hand. See [ENGINE_API.md](ENGINE_API.md).\n\n${body}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const report = engineApiReport();
  const previous = await readFile(ENGINE_API_REPORT, 'utf8').catch(() => '');
  await writeFile(ENGINE_API_REPORT, report);
  console.log(previous === report ? 'Engine API report unchanged.' : `Engine API report written to ${relative(root, ENGINE_API_REPORT)}.`);
}
