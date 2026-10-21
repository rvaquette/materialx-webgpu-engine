import { describe, expect, it, vi } from 'vitest';
import { ensureAuditPage, resumeAuditReport } from '../../scripts/audit-mtlx-compilation.mjs';

describe('audit browser tab recovery', () => {
  it('reuses an existing audit tab', async () => {
    const page = { webSocketDebuggerUrl: 'ws://existing' };
    const launch = vi.fn();
    expect(await ensureAuditPage({ find: async () => page, launch })).toBe(page);
    expect(launch).not.toHaveBeenCalled();
  });

  it('reopens Chrome when a disconnected target has disappeared', async () => {
    const page = { webSocketDebuggerUrl: 'ws://replacement' };
    const find = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(page);
    const launch = vi.fn().mockResolvedValue(undefined);
    expect(await ensureAuditPage({ find, launch })).toBe(page);
    expect(launch).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('reports a bounded failure if Chrome cannot create a new tab', async () => {
    await expect(ensureAuditPage({ find: async () => undefined, launch: async () => {}, timeout: 1 }))
      .rejects.toThrow('after reopening Chrome');
  });

  it('preserves saved results and retries files interrupted by CDP', () => {
    const previous = {
      schemaVersion: 1, target: 'mobile', scope: { root: '.', filter: '' }, complete: false,
      error: 'Timed out: audit browser tab',
      files: [
        { file: 'ok.mtlx', status: 'compiled' },
        { file: 'unsupported.mtlx', status: 'incomplete' },
        { file: 'shader.mtlx', status: 'failed', materials: [{ shaders: [{ failure: 'Invalid WGSL' }] }] },
        { file: 'interrupted.mtlx', status: 'failed', reason: 'Error: CDP connection closed' },
      ],
    };
    const report = resumeAuditReport(previous, {
      target: 'mobile', files: [...previous.files.map((file) => file.file), 'next.mtlx'], scope: { root: '.', filter: '' },
    });
    expect(report.files.map((file) => file.file)).toEqual(['ok.mtlx', 'unsupported.mtlx', 'shader.mtlx']);
    expect(report.complete).toBe(false);
    expect(report.totalFiles).toBe(5);
    expect(report.error).toBeUndefined();
    expect(previous.files).toHaveLength(4);
  });

  it('rejects resume with a different target or file selection', () => {
    const previous = { schemaVersion: 1, target: 'mobile', scope: { root: '.', filter: '' }, files: [{ file: 'ok.mtlx', status: 'compiled' }] };
    expect(() => resumeAuditReport(previous, { target: 'local', files: ['ok.mtlx'], scope: previous.scope })).toThrow('same target');
    expect(() => resumeAuditReport(previous, { target: 'mobile', files: ['other.mtlx'], scope: previous.scope })).toThrow('file selection');
  });
});