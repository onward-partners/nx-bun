import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import buildExecutor from './executor';

let ws: string;
const ctx = () => ({ root: ws }) as any;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'nx-bun-build-'));
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

function write(rel: string, content: string) {
  const file = join(ws, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

describe('build executor', () => {
  test('plugins stub a package through Bun.build()', async () => {
    write('src/main.ts', "import x from 'unused-pkg';\nconsole.log(x);\n");
    write(
      'plugins.ts',
      `export default {
        name: 'stub',
        setup(build) {
          build.onResolve({ filter: /^unused-pkg$/ }, () => ({ path: 'unused', namespace: 'stub' }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default "STUBBED"', loader: 'js' }));
        },
      };`,
    );
    const result = await buildExecutor(
      {
        entryPoints: ['src/main.ts'],
        outputPath: 'dist',
        target: 'bun',
        plugins: ['plugins.ts'],
      },
      ctx(),
    );
    expect(result).toEqual({ success: true });
    expect(readFileSync(join(ws, 'dist/main.js'), 'utf8')).toContain('STUBBED');
  });

  test('plugins reject raw args', async () => {
    write('src/main.ts', '');
    write('p.ts', 'export default { name: "n", setup() {} };');
    await expect(
      buildExecutor(
        {
          entryPoints: ['src/main.ts'],
          outputPath: 'dist',
          plugins: ['p.ts'],
          args: ['--minify'],
        },
        ctx(),
      ),
    ).rejects.toThrow('cannot be combined');
  });

  test('clean empties the output folder first', async () => {
    write('src/main.ts', 'console.log(1);\n');
    write('dist/stale.js', 'old');
    const result = await buildExecutor(
      { entryPoints: ['src/main.ts'], outputPath: 'dist', clean: true },
      ctx(),
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(ws, 'dist/stale.js'))).toBe(false);
    expect(existsSync(join(ws, 'dist/main.js'))).toBe(true);
  });

  test('clean refuses paths outside the workspace or its root', async () => {
    for (const outputPath of ['.', '..', join(tmpdir(), 'elsewhere')]) {
      await expect(
        buildExecutor(
          { entryPoints: ['src/main.ts'], outputPath, clean: true },
          ctx(),
        ),
      ).rejects.toThrow('Refusing to clean');
    }
  });
});
