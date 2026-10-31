/** Remove only functions unreachable from explicit entry points in generated WGSL.
 * Reachable function bodies and all module declarations remain byte-for-byte intact. */
export function pruneWgslFunctions(code: string, entryPoints: readonly string[]): string {
  const chars = code.split('');
  let blockDepth = 0;
  let lineComment = false;
  for (let i = 0; i < chars.length; i++) {
    const pair = code.slice(i, i + 2);
    if (lineComment) {
      if (code[i] === '\n') lineComment = false;
      else chars[i] = ' ';
    } else if (blockDepth > 0) {
      if (pair === '/*') { blockDepth++; chars[i] = chars[i + 1] = ' '; i++; }
      else if (pair === '*/') { blockDepth--; chars[i] = chars[i + 1] = ' '; i++; }
      else if (code[i] !== '\n') chars[i] = ' ';
    } else if (pair === '//') {
      lineComment = true;
      chars[i] = chars[i + 1] = ' ';
      i++;
    } else if (pair === '/*') {
      blockDepth = 1;
      chars[i] = chars[i + 1] = ' ';
      i++;
    }
  }
  if (blockDepth) throw new Error('Unterminated WGSL block comment.');
  const masked = chars.join('');
  const functions = new Map<string, { start: number; end: number; identifiers: string[] }>();
  const attributed = new Set<string>();
  const declarations = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
  for (let match = declarations.exec(masked); match; match = declarations.exec(masked)) {
    const start = match.index;
    const open = masked.indexOf('{', declarations.lastIndex);
    if (open < 0) throw new Error(`Missing WGSL function body: ${match[1]}`);
    let depth = 1;
    let end = open + 1;
    for (; end < masked.length && depth > 0; end++) {
      if (masked[end] === '{') depth++;
      else if (masked[end] === '}') depth--;
    }
    if (depth) throw new Error(`Unterminated WGSL function: ${match[1]}`);
    const name = match[1]!;
    const previousDeclaration = Math.max(masked.lastIndexOf(';', start), masked.lastIndexOf('}', start));
    // Keep attributed functions conservatively so an orphaned attribute cannot
    // attach to the following declaration after removing a function body.
    if (masked.slice(previousDeclaration + 1, start).includes('@')) attributed.add(name);
    if (functions.has(name)) throw new Error(`Duplicate WGSL function: ${name}`);
    functions.set(name, { start, end, identifiers: masked.slice(start, end).match(/\b[A-Za-z_]\w*\b/g) ?? [] });
    declarations.lastIndex = end;
  }
  const globals = masked.split('');
  for (const { start, end } of functions.values()) globals.fill(' ', start, end);
  const pending = [...entryPoints, ...attributed, ...(globals.join('').match(/\b[A-Za-z_]\w*\b/g) ?? [])];
  for (const entry of entryPoints) {
    if (!functions.has(entry)) throw new Error(`Unknown WGSL entry point: ${entry}`);
  }
  const reachable = new Set<string>();
  while (pending.length) {
    const name = pending.pop()!;
    const fn = functions.get(name);
    if (!fn || reachable.has(name)) continue;
    reachable.add(name);
    pending.push(...fn.identifiers);
  }
  let cursor = 0;
  const result: string[] = [];
  for (const [name, { start, end }] of functions) {
    if (reachable.has(name)) continue;
    result.push(code.slice(cursor, start));
    cursor = end;
  }
  result.push(code.slice(cursor));
  return result.join('');
}
