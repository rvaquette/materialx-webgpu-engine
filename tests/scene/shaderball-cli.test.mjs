import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = args => execFileSync(process.execPath, ['scripts/run-shaderball-renders.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('shaderball tilespp CLI', () => {
  it('documents the option and preserves target-specific defaults', () => {
    expect(run(['--help'])).toContain('--tilespp N');
    expect(run(['--list', '--target', 'local'])).toContain('tilespp=4');
    expect(run(['--list', '--target', 'mobile'])).toContain('tilespp=1');
  });

  it('accepts an explicit samples-per-tile override on either target', () => {
    for (const target of ['local', 'mobile']) {
      expect(run(['--list', '--target', target, '--tilespp', '2'])).toContain('tilespp=2');
    }
  });

  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '', '9007199254740992'])('rejects invalid tilespp %j before starting resources', value => {
    expect(() => run(['--list', `--tilespp=${value}`])).toThrow('--tilespp must be a positive safe integer');
  });
});
