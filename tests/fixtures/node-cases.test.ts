import { describe, expect, it } from 'vitest';
import inventory from './materialx-nodes.json' with { type: 'json' };
import {
  NODE_CASES,
  NODE_CASES_BY_CATEGORY,
  VARYINGS,
  expectedLength,
  type NodeCase,
} from './node-cases.ts';
import { isNodeCovered } from '../../src/compiler/nodes.ts';

const corpusCategories = inventory.nodes.map((n) => n.category);

describe('node-cases coverage', () => {
  it('defines exactly one case per corpus category', () => {
    const caseCategories = NODE_CASES.map((c) => c.category);
    expect(new Set(caseCategories).size).toBe(caseCategories.length);
    expect([...caseCategories].sort()).toEqual([...corpusCategories].sort());
  });

  it('references only categories present in the corpus inventory', () => {
    const corpus = new Set(corpusCategories);
    for (const c of NODE_CASES) expect(corpus.has(c.category)).toBe(true);
  });
});

describe('node-cases shape', () => {
  const runnable = NODE_CASES.filter((c) => c.exec === 'expr' || c.exec === 'texture' || c.exec === 'closure');
  const deferred = NODE_CASES.filter((c) => c.exec === 'graph' || c.exec === 'implicit' || c.exec === 'multi');

  it('gives every runnable case a finite expected output of the declared width', () => {
    for (const c of runnable) {
      expect(c.out).not.toBeNull();
      expect(c.expected).not.toBeNull();
      const expected = c.expected as readonly number[];
      expect(expected).toHaveLength(expectedLength(c.out!));
      for (const v of expected) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('leaves no scalar output on deferred graph/implicit/multi cases', () => {
    for (const c of deferred) {
      expect(c.out).toBeNull();
      expect(c.expected).toBeNull();
      expect(c.note).toBeTruthy();
    }
  });

  it('matches every expr/closure case to a real lowering in the registry', () => {
    for (const c of runnable) {
      if (c.exec === 'texture') continue; // textures are PRIMITIVE_LOWERED, verified below
      expect(isNodeCovered(c.category)).toBe(true);
    }
  });

  it('keeps texture cases on primitive-lowered categories', () => {
    for (const c of NODE_CASES.filter((x) => x.exec === 'texture')) {
      expect(isNodeCovered(c.category)).toBe(true);
    }
  });
});

describe('node-cases reference values', () => {
  const get = (cat: string): NodeCase => {
    const c = NODE_CASES_BY_CATEGORY.get(cat);
    if (!c) throw new Error(`missing case ${cat}`);
    return c;
  };
  const near = (a: readonly number[], b: readonly number[]): void => {
    expect(a).toHaveLength(b.length);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));
  };

  it('locks elementary arithmetic semantics', () => {
    near(get('add').expected!, [0.3, 0.9, 1.05]);
    near(get('subtract').expected!, [0.1, 0.1, 0.55]);
    near(get('dotproduct').expected!, [0.2 * 0.1 + 0.5 * 0.4 + 0.8 * 0.25]);
  });

  it('locks the mix argument-swap convention (bg*(1-t) + fg*t)', () => {
    // fg = [0.2,0.5,0.8], bg = [0.1,0.4,0.25], t = 0.25
    near(get('mix').expected!, [0.1 * 0.75 + 0.2 * 0.25, 0.4 * 0.75 + 0.5 * 0.25, 0.25 * 0.75 + 0.8 * 0.25]);
  });

  it('keeps geometry leaves equal to the fixed varyings', () => {
    near(get('position').expected!, VARYINGS.position);
    near(get('texcoord').expected!, VARYINGS.texcoord);
  });

  it('produces a unit-length normal from normalmap', () => {
    const n = get('normalmap').expected!;
    expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 6);
  });
});
