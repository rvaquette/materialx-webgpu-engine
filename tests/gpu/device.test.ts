import { describe, it, expect } from 'vitest';
import { filterSupportedFeatures, resolveRequiredLimits, type Diagnostic } from '../../src/gpu/device.ts';

function collector() {
  const diagnostics: Diagnostic[] = [];
  return { diagnostics, sink: (d: Diagnostic) => diagnostics.push(d) };
}

const adapter = {
  features: new Set<GPUFeatureName>(['depth-clip-control']),
  limits: { maxBufferSize: 1000, maxBindGroups: 4 },
} as unknown as GPUAdapter;

describe('filterSupportedFeatures', () => {
  it('keeps supported features and warns on unavailable ones', () => {
    const { diagnostics, sink } = collector();
    const result = filterSupportedFeatures(
      adapter,
      ['depth-clip-control', 'timestamp-query'],
      sink,
    );
    expect(result).toEqual(['depth-clip-control']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.level).toBe('warning');
    expect(diagnostics[0]?.message).toContain('timestamp-query');
  });

  it('returns an empty list when nothing is requested', () => {
    const { diagnostics, sink } = collector();
    expect(filterSupportedFeatures(adapter, undefined, sink)).toEqual([]);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('resolveRequiredLimits', () => {
  it('clamps over-limit requests, keeps valid ones, and drops unknown keys', () => {
    const { diagnostics, sink } = collector();
    const resolved = resolveRequiredLimits(
      adapter,
      { maxBufferSize: 2000, maxBindGroups: 2, notARealLimit: 5 },
      sink,
    );
    expect(resolved).toEqual({ maxBufferSize: 1000, maxBindGroups: 2 });
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('maxBufferSize');
    expect(messages).toContain('notARealLimit');
  });
});
