import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodesV2, globToRegExp } from './plugin';

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'nx-bun-plugin-'));
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

function write(rel: string, content = '') {
  const file = join(ws, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

async function infer(files: string[], options: Record<string, unknown> = {}) {
  const results = await createNodesV2[1](files, options, {
    workspaceRoot: ws,
    nxJsonConfiguration: {},
  } as any);
  return Object.fromEntries(
    results.flatMap(([, r]) => Object.entries((r as any).projects ?? {})),
  ) as Record<string, { root: string; targets: Record<string, any> }>;
}

describe('createNodesV2', () => {
  test('glob targets bunfig.toml', () => {
    expect(createNodesV2[0]).toBe('**/bunfig.toml');
  });

  test('ignores bunfig.toml without package.json or project.json', async () => {
    write('tools/bunfig.toml');
    expect(await infer(['tools/bunfig.toml'])).toEqual({});
  });

  test('private app with tests and entry gets the full target set', async () => {
    write('apps/a/bunfig.toml');
    write('apps/a/package.json', JSON.stringify({ name: 'a', private: true }));
    write('apps/a/src/main.ts');
    write('apps/a/src/main.test.ts');
    const { 'apps/a': p } = await infer(['apps/a/bunfig.toml']);
    expect(Object.keys(p.targets).sort()).toEqual(
      [
        'bun-build',
        'bun-fmt',
        'bun-fmt-check',
        'bun-prune-lockfile',
        'bun-serve',
        'bun-start',
        'bun-test',
      ].sort(),
    );
    expect(p.targets['bun-build'].options).toMatchObject({
      entryPoints: ['apps/a/src/main.ts'],
      outputPath: 'dist/apps/a',
      target: 'bun',
    });
    expect(p.targets['bun-serve']).toMatchObject({ continuous: true });
    expect(p.targets['bun-start'].options.buildTarget).toBe('a:bun-build');
    expect(p.targets['nx-release-publish']).toBeUndefined();
  });

  test('no tests and no entry: only fmt targets', async () => {
    write('libs/x/bunfig.toml');
    write('libs/x/project.json', JSON.stringify({ name: 'x' }));
    const { 'libs/x': p } = await infer(['libs/x/bunfig.toml']);
    expect(Object.keys(p.targets).sort()).toEqual(['bun-fmt', 'bun-fmt-check']);
  });

  test('publishable library builds a package and gets a release target', async () => {
    write('libs/pub/bunfig.toml');
    write(
      'libs/pub/package.json',
      JSON.stringify({ name: '@acme/pub', version: '1.0.0' }),
    );
    write('libs/pub/tsconfig.json', '{}');
    write('libs/pub/src/index.ts');
    const { 'libs/pub': p } = await infer(['libs/pub/bunfig.toml']);
    expect(p.targets['bun-build'].options).toMatchObject({
      target: 'node',
      packages: 'external',
      generatePackageJson: true,
      dts: true,
    });
    expect(p.targets['bun-prune-lockfile']).toBeUndefined();
    expect(p.targets['nx-release-publish']).toMatchObject({
      executor: '@onward-partners/nx-bun:release-publish',
      options: { packageRoot: 'dist/libs/pub' },
    });
    expect(p.targets['bun-start'].options.buildTarget).toBe(
      '@acme/pub:bun-build',
    );
  });

  test('releasePublish: false disables the release target', async () => {
    write('libs/pub/bunfig.toml');
    write('libs/pub/package.json', JSON.stringify({ name: 'pub' }));
    write('libs/pub/src/index.ts');
    const { 'libs/pub': p } = await infer(['libs/pub/bunfig.toml'], {
      releasePublish: false,
    });
    expect(p.targets['nx-release-publish']).toBeUndefined();
  });

  test('target names are configurable', async () => {
    write('apps/a/bunfig.toml');
    write('apps/a/package.json', JSON.stringify({ name: 'a', private: true }));
    write('apps/a/src/main.ts');
    const { 'apps/a': p } = await infer(['apps/a/bunfig.toml'], {
      buildTargetName: 'build',
      serveTargetName: 'serve',
      startTargetName: 'start',
      fmtTargetName: 'format',
    });
    expect(Object.keys(p.targets)).toEqual(
      expect.arrayContaining(['build', 'serve', 'start', 'format']),
    );
    expect(p.targets['start'].options.buildTarget).toBe('a:build');
  });

  describe('cache configuration', () => {
    const runtime = { runtime: 'bun --version' };
    const nodeEnv = { env: 'NODE_ENV' };

    async function privateApp() {
      write('apps/a/bunfig.toml');
      write(
        'apps/a/package.json',
        JSON.stringify({ name: 'a', private: true }),
      );
      write('apps/a/src/main.ts');
      write('apps/a/src/main.test.ts');
      return (await infer(['apps/a/bunfig.toml']))['apps/a'];
    }

    test('build and test hash the Bun version and NODE_ENV', async () => {
      const p = await privateApp();
      for (const t of ['bun-build', 'bun-test']) {
        expect(p.targets[t].cache).toBe(true);
        expect(p.targets[t].inputs).toEqual(
          expect.arrayContaining([runtime, nodeEnv]),
        );
      }
      expect(p.targets['bun-fmt-check'].inputs).toContainEqual(runtime);
    });

    test('build has no dependsOn on a target that does not exist', async () => {
      const p = await privateApp();
      expect(p.targets['bun-build'].dependsOn).toBeUndefined();
    });

    test('prune-lockfile does not hash the whole workspace lockfile', async () => {
      const p = await privateApp();
      const inputs = JSON.stringify(p.targets['bun-prune-lockfile'].inputs);
      expect(inputs).not.toContain('bun.lock');
      expect(p.targets['bun-prune-lockfile'].inputs).toContainEqual(runtime);
    });

    test('non-cacheable targets stay uncached', async () => {
      const p = await privateApp();
      for (const t of ['bun-fmt', 'bun-serve', 'bun-start'])
        expect(p.targets[t].cache).toBe(false);
    });

    test('dts builds also depend on the typescript version', async () => {
      write('libs/pub/bunfig.toml');
      write('libs/pub/package.json', JSON.stringify({ name: 'pub' }));
      write('libs/pub/tsconfig.json', '{}');
      write('libs/pub/src/index.ts');
      const { 'libs/pub': p } = await infer(['libs/pub/bunfig.toml']);
      expect(p.targets['bun-build'].inputs).toContainEqual({
        externalDependencies: ['typescript'],
      });
    });

    test('plain builds do not depend on typescript', async () => {
      const p = await privateApp();
      expect(JSON.stringify(p.targets['bun-build'].inputs)).not.toContain(
        'typescript',
      );
    });
  });

  describe('opting out', () => {
    async function app(options: Record<string, unknown>, root = 'apps/a') {
      write(`${root}/bunfig.toml`);
      write(`${root}/package.json`, JSON.stringify({ name: 'a', private: true }));
      write(`${root}/src/main.ts`);
      write(`${root}/src/main.test.ts`);
      return (await infer([`${root}/bunfig.toml`], options))[root];
    }

    test('a target name of false skips that target', async () => {
      const p = await app({ fmtTargetName: false, fmtCheckTargetName: false });
      expect(Object.keys(p.targets)).not.toContain('bun-fmt');
      expect(Object.keys(p.targets)).not.toContain('bun-fmt-check');
      expect(p.targets['bun-build']).toBeDefined();
    });

    test('without a build target, start and prune are skipped', async () => {
      const p = await app({ buildTargetName: false });
      expect(Object.keys(p.targets).sort()).toEqual(
        ['bun-fmt', 'bun-fmt-check', 'bun-serve', 'bun-test'].sort(),
      );
    });

    test('release publish does not depend on a skipped build', async () => {
      write('libs/pub/bunfig.toml');
      write('libs/pub/package.json', JSON.stringify({ name: 'pub' }));
      write('libs/pub/src/index.ts');
      const { 'libs/pub': p } = await infer(['libs/pub/bunfig.toml'], {
        buildTargetName: false,
      });
      expect(p.targets['nx-release-publish'].dependsOn).toEqual([
        '^nx-release-publish',
      ]);
    });

    test('exclude drops matching project roots', async () => {
      expect(await app({ exclude: ['apps/*'] })).toBeUndefined();
    });

    test('include keeps only matching project roots', async () => {
      expect(await app({ include: ['libs/**'] })).toBeUndefined();
      expect(await app({ include: ['apps/**'] }, 'apps/b')).toBeDefined();
    });

    test('a root bunfig.toml is not a project', async () => {
      write('bunfig.toml');
      write('package.json', JSON.stringify({ name: 'root', private: true }));
      write('src/main.test.ts');
      expect(await infer(['bunfig.toml'])).toEqual({});
    });

    test('rootProject: true makes the root a project', async () => {
      write('bunfig.toml');
      write('package.json', JSON.stringify({ name: 'root', private: true }));
      const result = await infer(['bunfig.toml'], { rootProject: true });
      expect(result['.']).toBeDefined();
    });
  });

  describe('globToRegExp', () => {
    test('* stays in one segment, ** crosses segments', () => {
      expect(globToRegExp('apps/*').test('apps/a')).toBe(true);
      expect(globToRegExp('apps/*').test('apps/a/b')).toBe(false);
      expect(globToRegExp('apps/**').test('apps/a/b')).toBe(true);
      expect(globToRegExp('**/cli').test('cli')).toBe(true);
      expect(globToRegExp('**/cli').test('tools/x/cli')).toBe(true);
      expect(globToRegExp('libs/a.b').test('libs/aXb')).toBe(false);
    });
  });

  test('tests in node_modules and dist are ignored', async () => {
    write('apps/a/bunfig.toml');
    write('apps/a/package.json', JSON.stringify({ name: 'a', private: true }));
    write('apps/a/node_modules/x/x.test.ts');
    write('apps/a/dist/y.spec.ts');
    const { 'apps/a': p } = await infer(['apps/a/bunfig.toml']);
    expect(p.targets['bun-test']).toBeUndefined();
  });
});
