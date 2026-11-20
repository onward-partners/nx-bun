import { describe, expect, test } from 'bun:test';
import {
  addProjectConfiguration,
  readJson,
  readNxJson,
  type Tree,
} from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import applicationGenerator from './application/generator';
import initGenerator from './init/generator';
import libraryGenerator from './library/generator';
import projectGenerator from './project/generator';

function workspace(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write(
    'tsconfig.base.json',
    JSON.stringify({ compilerOptions: { paths: {} } }),
  );
  return tree;
}

describe('init', () => {
  test('registers the plugin once and adds @types/bun', async () => {
    const tree = workspace();
    await initGenerator(tree, { skipFormat: true });
    await initGenerator(tree, { skipFormat: true });
    const plugins = readNxJson(tree)?.plugins ?? [];
    expect(
      plugins.filter((p: any) => p.plugin === '@onward-partners/nx-bun'),
    ).toHaveLength(1);
    expect(
      readJson(tree, 'package.json').devDependencies['@types/bun'],
    ).toBeDefined();
  });

  test('setPackageManager writes cli.packageManager', async () => {
    const tree = workspace();
    await initGenerator(tree, { skipFormat: true, setPackageManager: true });
    expect(readNxJson(tree)?.cli?.packageManager).toBe('bun');
  });

  test('skipPackageJson leaves dependencies alone', async () => {
    const tree = workspace();
    await initGenerator(tree, { skipFormat: true, skipPackageJson: true });
    expect(
      readJson(tree, 'package.json').devDependencies?.['@types/bun'],
    ).toBeUndefined();
  });
});

describe('application', () => {
  test('creates files under apps/<name>', async () => {
    const tree = workspace();
    await applicationGenerator(tree, { name: 'api', skipFormat: true });
    for (const f of [
      'package.json',
      'bunfig.toml',
      'tsconfig.json',
      'src/main.ts',
      'src/main.test.ts',
    ]) {
      expect(tree.exists(`apps/api/${f}`)).toBe(true);
    }
    const pkg = readJson(tree, 'apps/api/package.json');
    expect(pkg.name).toBe('api');
    expect(tree.read('apps/api/tsconfig.json', 'utf-8')).toContain(
      '"../../tsconfig.base.json"',
    );
    expect(tree.read('apps/api/src/main.test.ts', 'utf-8')).toContain(
      "from 'bun:test'",
    );
    expect(tree.exists('apps/api/project.json')).toBe(false);
  });

  test('custom directory and tags', async () => {
    const tree = workspace();
    await applicationGenerator(tree, {
      name: 'web',
      directory: 'apps/team/web',
      tags: 'scope:web, type:app',
      skipFormat: true,
    });
    expect(readJson(tree, 'apps/team/web/package.json').nx.tags).toEqual([
      'scope:web',
      'type:app',
    ]);
  });

  test('unitTestRunner none removes the sample test', async () => {
    const tree = workspace();
    await applicationGenerator(tree, {
      name: 'x',
      unitTestRunner: 'none',
      skipFormat: true,
    });
    expect(tree.exists('apps/x/src/main.test.ts')).toBe(false);
  });

  test('useProjectJson creates a project.json', async () => {
    const tree = workspace();
    await applicationGenerator(tree, {
      name: 'p',
      useProjectJson: true,
      skipFormat: true,
    });
    expect(tree.exists('apps/p/project.json')).toBe(true);
  });
});

describe('library', () => {
  test('creates a source-linked library and a tsconfig path', async () => {
    const tree = workspace();
    await libraryGenerator(tree, {
      name: 'util',
      importPath: '@acme/util',
      skipFormat: true,
    });
    for (const f of [
      'package.json',
      'bunfig.toml',
      'tsconfig.json',
      'src/index.ts',
      'src/lib/util.ts',
      'src/lib/util.test.ts',
    ]) {
      expect(tree.exists(`libs/util/${f}`)).toBe(true);
    }
    // no baseUrl in this workspace, so the mapping must be relative
    expect(
      readJson(tree, 'tsconfig.base.json').compilerOptions.paths['@acme/util'],
    ).toEqual(['./libs/util/src/index.ts']);
    const pkg = readJson(tree, 'libs/util/package.json');
    expect(pkg).toMatchObject({
      name: '@acme/util',
      private: true,
      main: './src/index.ts',
    });
    expect(tree.read('libs/util/src/index.ts', 'utf-8')).toContain(
      './lib/util',
    );
  });

  test('keeps plain paths when baseUrl is set', async () => {
    const tree = workspace();
    tree.write(
      'tsconfig.base.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: {} } }),
    );
    await libraryGenerator(tree, {
      name: 'util',
      importPath: '@acme/util',
      skipFormat: true,
    });
    expect(
      readJson(tree, 'tsconfig.base.json').compilerOptions.paths['@acme/util'],
    ).toEqual(['libs/util/src/index.ts']);
  });

  test('publishable libraries point at the build output', async () => {
    const tree = workspace();
    await libraryGenerator(tree, {
      name: 'ui',
      importPath: '@acme/ui',
      publishable: true,
      skipFormat: true,
    });
    const pkg = readJson(tree, 'libs/ui/package.json');
    expect(pkg.private).toBeUndefined();
    expect(pkg.main).toBe('./index.js');
    expect(pkg.types).toBe('./index.d.ts');
  });

  test('publishable needs an importPath', async () => {
    await expect(
      libraryGenerator(workspace(), {
        name: 'ui',
        publishable: true,
        skipFormat: true,
      }),
    ).rejects.toThrow(/importPath/);
  });

  test('rejects a duplicate import path', async () => {
    const tree = workspace();
    await libraryGenerator(tree, {
      name: 'a',
      importPath: '@acme/x',
      skipFormat: true,
    });
    await expect(
      libraryGenerator(tree, {
        name: 'b',
        importPath: '@acme/x',
        skipFormat: true,
      }),
    ).rejects.toThrow(/already used/);
  });

  test('camelCases the exported function name', async () => {
    const tree = workspace();
    await libraryGenerator(tree, {
      name: 'my-lib',
      importPath: '@acme/my-lib',
      skipFormat: true,
    });
    expect(tree.read('libs/my-lib/src/lib/my-lib.ts', 'utf-8')).toContain(
      'export function myLib()',
    );
    expect(tree.read('libs/my-lib/src/lib/my-lib.test.ts', 'utf-8')).toContain(
      "from './my-lib'",
    );
  });
});

describe('project', () => {
  test('adds bunfig.toml to an existing project', async () => {
    const tree = workspace();
    tree.write('libs/old/package.json', JSON.stringify({ name: 'old' }));
    addProjectConfiguration(tree, 'old', { root: 'libs/old', targets: {} });
    await projectGenerator(tree, { project: 'old', skipFormat: true });
    expect(tree.exists('libs/old/bunfig.toml')).toBe(true);
  });

  test('keeps an existing bunfig.toml', async () => {
    const tree = workspace();
    tree.write('libs/old/package.json', '{}');
    tree.write('libs/old/bunfig.toml', '# mine\n');
    addProjectConfiguration(tree, 'old', { root: 'libs/old', targets: {} });
    await projectGenerator(tree, { project: 'old', skipFormat: true });
    expect(tree.read('libs/old/bunfig.toml', 'utf-8')).toBe('# mine\n');
  });
});
