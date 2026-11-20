import { describe, expect, test } from 'bun:test';
import { collectNpmDependencies, filterDependencies } from './dependencies';

const graph = {
  nodes: { app: {}, lib: {}, leaf: {} },
  externalNodes: {
    'npm:zod': { data: { packageName: 'zod', version: '3.23.8' } },
    'npm:@scope/pkg': { data: { packageName: '@scope/pkg', version: '1.2.3' } },
    'npm:hono': { data: { packageName: 'hono', version: '4.6.0' } },
  },
  dependencies: {
    app: [
      { source: 'app', target: 'lib', type: 'static' },
      { source: 'app', target: 'npm:zod', type: 'static' },
    ],
    lib: [
      { source: 'lib', target: 'npm:@scope/pkg', type: 'static' },
      { source: 'lib', target: 'leaf', type: 'static' },
    ],
    leaf: [
      { source: 'leaf', target: 'npm:hono', type: 'static' },
      { source: 'leaf', target: 'app', type: 'static' }, // cycle must not hang
    ],
  },
} as any;

describe('collectNpmDependencies', () => {
  test('follows workspace libraries transitively and sorts by name', () => {
    expect(collectNpmDependencies(graph, 'app')).toEqual({
      '@scope/pkg': '1.2.3',
      hono: '4.6.0',
      zod: '3.23.8',
    });
  });

  test('only direct and transitive deps of the project', () => {
    expect(collectNpmDependencies(graph, 'leaf')).toEqual({
      '@scope/pkg': '1.2.3',
      hono: '4.6.0',
      zod: '3.23.8',
    });
    expect(
      collectNpmDependencies(
        { ...graph, dependencies: { lib2: [] }, nodes: { lib2: {} } },
        'lib2',
      ),
    ).toEqual({});
  });
});

describe('filterDependencies', () => {
  const deps = { zod: '1', '@scope/a': '2', '@scope/b': '3', hono: '4' };
  test('all keeps everything', () =>
    expect(filterDependencies(deps, 'all')).toEqual(deps));
  test('matches names and scopes', () => {
    expect(filterDependencies(deps, ['zod', '@scope'])).toEqual({
      zod: '1',
      '@scope/a': '2',
      '@scope/b': '3',
    });
  });
  test('empty list keeps nothing', () =>
    expect(filterDependencies(deps, [])).toEqual({}));
});
