import { describe, expect, it } from 'vitest';
import { pruneWgslFunctions } from '../../src/compiler/wgsl-reachability.ts';

describe('generated WGSL function reachability', () => {
  it('preserves reachable bodies verbatim, including transitive and forward calls', () => {
    const live = 'fn live() -> f32 { if (true) { return leaf(); } return 0.0; }';
    const leaf = 'fn leaf() -> f32 { return 1.0; }';
    const code = `const X = 1.0;\n${live}\nfn dead() { live(); }\n${leaf}\n@compute @workgroup_size(1) fn main() { let x = live(); }`;
    const result = pruneWgslFunctions(code, ['main']);
    expect(result).toContain(live);
    expect(result).toContain(leaf);
    expect(result).toContain('@compute @workgroup_size(1) fn main()');
    expect(result).toContain('const X = 1.0;');
    expect(result).not.toContain('fn dead');
    expect(pruneWgslFunctions(result, ['main'])).toBe(result);
  });
  it('ignores fake declarations, braces and calls in nested comments', () => {
    const code = `// fn fake() { }
fn dead() {}
fn leaf() {}
fn main() { /* { dead(); /* fn nested() {} */ } */ // dead();
leaf(); }`;
    const result = pruneWgslFunctions(code, ['main']);
    expect(result).not.toContain('fn dead()');
    expect(result).toContain('fn leaf()');
    expect(result).toContain('/* { dead(); /* fn nested() {} */ } */');
  });
  it('conservatively retains module references and multiple entry points', () => {
    const code = 'const X = global(); fn global() -> f32 { return 1.0; } fn first() {} fn second() {} fn dead() {}';
    const result = pruneWgslFunctions(code, ['first', 'second']);
    expect(result).toContain('fn global');
    expect(result).toContain('fn first');
    expect(result).toContain('fn second');
    expect(result).not.toContain('fn dead');
  });
  it('fails explicitly on invalid generated input', () => {
    expect(() => pruneWgslFunctions('fn main() {}', ['missing'])).toThrow('Unknown');
    expect(() => pruneWgslFunctions('fn main() {', ['main'])).toThrow('Unterminated');
    expect(() => pruneWgslFunctions('/*', ['main'])).toThrow('Unterminated');
    expect(() => pruneWgslFunctions('fn main() {} fn main() {}', ['main'])).toThrow('Duplicate');
  });
});
