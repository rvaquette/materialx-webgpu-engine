import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrowserOpenUsd } from '../../src/usd/browser-loader.ts';
import config from '../../vite.config.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser OpenUSD isolation', () => {
  it('rejects without isolation before importing bindings or creating workers', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    await expect(loadBrowserOpenUsd()).rejects.toThrow('Cross-Origin-Opener-Policy: same-origin');
    await expect(loadBrowserOpenUsd()).rejects.toThrow('npm run preview');
  });

  it('rejects when shared memory is unavailable even with isolation', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('SharedArrayBuffer', undefined);
    await expect(loadBrowserOpenUsd()).rejects.toThrow('SharedArrayBuffer');
  });

  it('can retry after an isolation failure', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    await expect(loadBrowserOpenUsd()).rejects.toThrow('cross-origin isolation');
    vi.stubGlobal('crossOriginIsolated', true);
    const baseURI = vi.fn(() => { throw new Error('Bindings URL reached'); });
    vi.stubGlobal('document', { get baseURI() { return baseURI(); } });
    await expect(loadBrowserOpenUsd()).rejects.toThrow('Bindings URL reached');
    expect(baseURI).toHaveBeenCalledOnce();
  });

  it('configures isolation for development and built-app preview', () => {
    const headers = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    };
    expect(config.server?.headers).toEqual(headers);
    expect(config.preview?.headers).toEqual(headers);
  });
});
