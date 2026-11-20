import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import releasePublish, { publishArgs } from './executor';

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'nx-bun-publish-'));
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe('release-publish', () => {
  test('requires a built package.json', async () => {
    await expect(
      releasePublish({ packageRoot: 'dist/x' }, { root: ws } as any),
    ).rejects.toThrow('No package.json');
  });

  test('builds bun publish flags and ignores nx-only options', () => {
    expect(
      publishArgs({
        dryRun: true,
        tag: 'next',
        registry: 'https://npm.pkg.github.com',
        firstRelease: true,
        packageRoot: 'dist/x',
      }),
    ).toEqual([
      'publish',
      '--registry=https://npm.pkg.github.com',
      '--tag=next',
      '--dry-run',
      '--tolerate-republish',
    ]);
  });

  test('tolerateRepublish can be turned off', () => {
    expect(publishArgs({ tolerateRepublish: false })).toEqual(['publish']);
  });
});
