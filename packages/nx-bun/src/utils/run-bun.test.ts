import { afterEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bunBinary,
  normalizeCwd,
  resolveCwd,
  runProcess,
  toFlags,
  toPosix,
} from './run-bun';

/** 8.3 short form of a path, or the path itself when the volume has none. */
function shortPath(dir: string): string {
  try {
    return execSync(`for %I in ("${dir}") do @echo %~sI`, {
      shell: 'cmd.exe',
      encoding: 'utf8',
    }).trim();
  } catch {
    return dir;
  }
}

describe('normalizeCwd', () => {
  test('only touches Windows paths', () => {
    expect(normalizeCwd('/does/not/matter', 'linux')).toBe('/does/not/matter');
    expect(normalizeCwd('/does/not/matter', 'darwin')).toBe('/does/not/matter');
  });

  test('returns the input when the directory does not exist', () => {
    const missing = join(tmpdir(), 'nx-bun-missing-dir-xyz');
    expect(normalizeCwd(missing, 'win32')).toBe(missing);
  });

  test.skipIf(process.platform !== 'win32')(
    'expands a short path so import.meta.main stays true',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'nx-bun long directory name '));
      try {
        writeFileSync(
          join(dir, 'main.ts'),
          'process.exit(import.meta.main ? 0 : 7);',
        );
        const short = shortPath(dir);
        // short names can be disabled on a volume; nothing to prove then
        if (short.toLowerCase() === dir.toLowerCase()) return;

        expect(normalizeCwd(short).toLowerCase()).toBe(
          realpathSync.native(dir).toLowerCase(),
        );
        const res = await runProcess(process.execPath, ['run', 'main.ts'], {
          cwd: short,
        });
        expect(res).toEqual({ success: true, code: 0 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('toFlags', () => {
  const table = {
    outdir: { flag: '--outdir', kind: 'value' },
    minify: { flag: '--minify', kind: 'bool' },
    external: { flag: '--external', kind: 'list' },
  } as const;

  test('maps values, booleans and lists', () => {
    expect(
      toFlags({ outdir: 'dist', minify: true, external: ['a', 'b'] }, table),
    ).toEqual([
      '--outdir=dist',
      '--minify',
      '--external',
      'a',
      '--external',
      'b',
    ]);
  });

  test('skips false, null and undefined', () => {
    expect(
      toFlags({ outdir: undefined, minify: false, external: null }, table),
    ).toEqual([]);
  });
});

describe('resolveCwd', () => {
  const context = {
    root: join('/ws'),
    projectName: 'app',
    projectsConfigurations: { projects: { app: { root: 'apps/app' } } },
  } as any;

  test('defaults to the workspace root or the project root', () => {
    expect(resolveCwd(context, undefined, 'workspace')).toBe(join('/ws'));
    expect(resolveCwd(context, undefined, 'project')).toBe(
      join('/ws', 'apps/app'),
    );
  });

  test('resolves relative cwd against the workspace root', () => {
    expect(resolveCwd(context, 'tools', 'project')).toBe(join('/ws', 'tools'));
  });
});

describe('bunBinary', () => {
  const saved = process.env.BUN_BIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.BUN_BIN;
    else process.env.BUN_BIN = saved;
  });

  test('BUN_BIN wins', () => {
    process.env.BUN_BIN = '/custom/bun';
    expect(bunBinary()).toBe('/custom/bun');
  });

  test('inside bun it is the current executable', () => {
    delete process.env.BUN_BIN;
    expect(bunBinary()).toBe(process.execPath);
  });
});

describe('runProcess', () => {
  test('reports success and failure by exit code', async () => {
    const ok = await runProcess(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: process.cwd(),
    });
    const bad = await runProcess(process.execPath, ['-e', 'process.exit(3)'], {
      cwd: process.cwd(),
    });
    expect(ok).toEqual({ success: true, code: 0 });
    expect(bad).toEqual({ success: false, code: 3 });
  });

  test('missing binary fails instead of throwing', async () => {
    const res = await runProcess('definitely-not-a-binary-xyz', [], {
      cwd: process.cwd(),
    });
    expect(res.success).toBe(false);
  });

  test('passes env to the child', async () => {
    const res = await runProcess(
      process.execPath,
      ['-e', 'process.exit(process.env.NX_BUN_TEST === "1" ? 0 : 1)'],
      { cwd: process.cwd(), env: { NX_BUN_TEST: '1' } },
    );
    expect(res.success).toBe(true);
  });
});

test('toPosix', () => {
  expect(toPosix('a\\b\\c')).toBe('a/b/c');
});
