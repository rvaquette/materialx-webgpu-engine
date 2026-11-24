import { describe, expect, it } from 'vitest';
import { EventStreamParser, remoteServerUrl } from '../src/remote-render.ts';

describe('remote render client', () => {
  it('parses server-sent events split across chunks and ignores keep-alive comments', () => {
    const parser = new EventStreamParser();
    expect(parser.push(': ping\n\nevent: frame\r\ndata: {"image":')).toEqual([]);
    expect(parser.push('"x"}\n\nevent: done\ndata: {"ok":true}\n\n')).toEqual([
      { event: 'frame', data: '{"image":"x"}' },
      { event: 'done', data: '{"ok":true}' },
    ]);
  });

  it('only accepts HTTPS servers, or HTTP on this machine', () => {
    expect(remoteServerUrl('https://render.example.com/api?x=1').href).toBe('https://render.example.com/api/');
    expect(remoteServerUrl('http://localhost:8787').href).toBe('http://localhost:8787/');
    expect(() => remoteServerUrl('http://render.example.com')).toThrow(/HTTPS/);
    expect(() => remoteServerUrl('https://user:pass@render.example.com')).toThrow(/identifiants/);
    expect(() => remoteServerUrl('pas une url')).toThrow(/invalide/);
  });
});
