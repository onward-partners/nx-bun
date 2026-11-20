import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveBuiltFile } from './executor';

const root = join('/ws');

describe('resolveBuiltFile', () => {
  test('uses outputPath + entry name', () => {
    expect(
      resolveBuiltFile(
        { entryPoints: ['apps/a/src/main.ts'], outputPath: 'dist/apps/a' },
        root,
      ),
    ).toBe(join(root, 'dist/apps/a', 'main.js'));
  });

  test('outfile wins over outputPath', () => {
    expect(
      resolveBuiltFile(
        {
          entryPoints: ['x.ts'],
          outputPath: 'dist/a',
          outfile: 'dist/a/bundle.js',
        },
        root,
      ),
    ).toBe(join(root, 'dist/a/bundle.js'));
  });

  test('adds .exe for compiled outfiles on Windows only', () => {
    const build = { entryPoints: ['x.ts'], outfile: 'dist/app', compile: true };
    expect(resolveBuiltFile(build, root, undefined, 'win32')).toBe(
      join(root, 'dist/app.exe'),
    );
    expect(resolveBuiltFile(build, root, undefined, 'linux')).toBe(
      join(root, 'dist/app'),
    );
    expect(resolveBuiltFile(build, root, undefined, 'darwin')).toBe(
      join(root, 'dist/app'),
    );
  });

  test('keeps an explicit extension', () => {
    expect(
      resolveBuiltFile(
        { entryPoints: ['x.ts'], outfile: 'dist/app.exe', compile: true },
        root,
        undefined,
        'win32',
      ),
    ).toBe(join(root, 'dist/app.exe'));
  });

  test('explicit override wins', () => {
    expect(
      resolveBuiltFile(
        { entryPoints: ['x.ts'], outputPath: 'd' },
        root,
        'custom/out.js',
      ),
    ).toBe(join(root, 'custom/out.js'));
  });

  test('throws when nothing can be derived', () => {
    expect(() => resolveBuiltFile({ entryPoints: [] }, root)).toThrow(
      /outputFile/,
    );
  });
});
