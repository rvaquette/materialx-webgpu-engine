import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = args => execFileSync(process.execPath, ['scripts/run-shaderball-renders.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('shaderball tilespp CLI', () => {
  it('accepts a compiled scene manifest for both capture backends and display modes', () => {
    const entry = '/scenes/compiled/volume_emission/scene.json';
    const list = run(['--list','--entry',entry]);
    expect(list).toContain('scene__raster');
    expect(list).toContain('scene__pathtracing');
    expect(list).toContain(entry);
    for (const mode of ['--headed','--integrated']) {
      expect(run(['--list','--entry',entry,mode])).toContain(entry);
    }
    expect(run(['--list','--entry',entry,'--target','mobile'])).toContain(entry);
    expect(run(['--help'])).toContain('scene.json');
  });

  it('rejects source material overrides and malformed compiled paths before allocating resources', () => {
    expect(() => run(['--list','--entry','/scenes/example/scene.json','--materials','all']))
      .toThrow('--materials is unavailable for compiled scenes');
    for (const entry of ['/scenes/../scene.json','/scenes/x/not-scene.json','/scenes/x/scene.json?x=1',
      '/scenes/%2e%2e/scene.json','/elsewhere/scene.json']) {
      expect(() => run(['--list','--entry',entry])).toThrow('--entry must be');
    }
  });
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
