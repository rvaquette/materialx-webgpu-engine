import { describe, it, expect, vi } from 'vitest';
import { AssetResolver, AssetResolutionError } from '../../src/assets/resolver.ts';

describe('AssetResolver', () => {
  it('resolves an author-relative path against the base document', () => {
    const r = new AssetResolver({ rootUrl: 'https://cdn/scene' });
    const { key, url } = r.resolve('textures/base.tif', 'materials/floor.mtlx');
    expect(key).toBe('materials/textures/base.tif');
    expect(url).toBe('https://cdn/scene/materials/textures/base.tif');
  });

  it('normalizes . and .. within the root', () => {
    const r = new AssetResolver({ rootUrl: 'https://cdn' });
    const { key } = r.resolve('../shared/./tex.tif', 'a/b/doc.mtlx');
    expect(key).toBe('a/shared/tex.tif');
  });

  it('rejects references that escape the asset root', () => {
    const onDiagnostic = vi.fn();
    const r = new AssetResolver({ rootUrl: 'https://cdn', onDiagnostic });
    expect(() => r.resolve('../../etc/passwd', 'doc.mtlx')).toThrow(AssetResolutionError);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('rejects local drive paths unless mapped', () => {
    const r = new AssetResolver({ rootUrl: 'https://cdn' });
    expect(() => r.resolve('D:\\tex\\color.tif')).toThrow(AssetResolutionError);
  });

  it('resolves local drive paths through the file map (basename tail)', () => {
    const fileMap = new Map([['tex/color.tif', 'blob:abc']]);
    const r = new AssetResolver({ fileMap });
    const { url } = r.resolve('D:\\tex\\color.tif');
    expect(url).toBe('blob:abc');
  });

  it('passes through ready URLs unchanged', () => {
    const r = new AssetResolver();
    expect(r.resolve('https://x/y.tif')).toEqual({ key: 'https://x/y.tif', url: 'https://x/y.tif' });
    expect(r.resolve('data:image/png;base64,AA').url).toBe('data:image/png;base64,AA');
  });

  it('expands UDIM tiles', () => {
    expect(AssetResolver.hasUdim('tex.<UDIM>.tif')).toBe(true);
    expect(AssetResolver.expandUdim('tex.<UDIM>.tif', 1001)).toBe('tex.1001.tif');
    const r = new AssetResolver({ rootUrl: 'https://cdn' });
    expect(r.resolveUdimTile('t/c.<UDIM>.tif', 1002, 'doc.mtlx').key).toBe('t/c.1002.tif');
  });

  it('throws when no asset root is configured', () => {
    const r = new AssetResolver();
    expect(() => r.resolve('textures/a.tif')).toThrow(AssetResolutionError);
  });
});
