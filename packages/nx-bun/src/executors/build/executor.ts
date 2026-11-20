import type { ExecutorContext } from '@nx/devkit';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  collectNpmDependencies,
  filterDependencies,
} from '../../utils/dependencies';
import { resolveCwd, runBun, runProcess, toFlags } from '../../utils/run-bun';

export interface BuildExecutorOptions {
  entryPoints: string[];
  outputPath?: string;
  outfile?: string;
  cwd?: string;
  target?: 'browser' | 'bun' | 'node';
  format?: 'esm' | 'cjs' | 'iife';
  minify?: boolean;
  sourcemap?: 'none' | 'linked' | 'inline' | 'external';
  splitting?: boolean;
  compile?: boolean;
  packages?: 'bundle' | 'external';
  external?: string[];
  define?: string[];
  /** Write a package.json (without dev tooling) next to the output. */
  generatePackageJson?: boolean;
  /** Emit .d.ts files with tsc next to the output. */
  dts?: boolean;
  /** tsconfig used for `dts`. Defaults to <projectRoot>/tsconfig.json. */
  tsConfig?: string;
  /** Files or folders copied into the output, relative to the workspace root. */
  assets?: string[];
  env?: Record<string, string>;
  args?: string[];
}

const FLAGS = {
  outputPath: { flag: '--outdir', kind: 'value' },
  outfile: { flag: '--outfile', kind: 'value' },
  target: { flag: '--target', kind: 'value' },
  format: { flag: '--format', kind: 'value' },
  sourcemap: { flag: '--sourcemap', kind: 'value' },
  packages: { flag: '--packages', kind: 'value' },
  minify: { flag: '--minify', kind: 'bool' },
  splitting: { flag: '--splitting', kind: 'bool' },
  compile: { flag: '--compile', kind: 'bool' },
  external: { flag: '--external', kind: 'list' },
  define: { flag: '--define', kind: 'list' },
} as const;

export default async function buildExecutor(
  options: BuildExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  if (!options.outfile && !options.outputPath) {
    throw new Error('Either `outputPath` or `outfile` is required.');
  }
  const cwd = resolveCwd(context, options.cwd, 'workspace');
  const args = [
    'build',
    ...options.entryPoints,
    // `outfile` wins over `outputPath` so configurations can switch to a single file.
    ...toFlags(
      (options.outfile
        ? { ...options, outputPath: undefined }
        : options) as unknown as Record<string, unknown>,
      FLAGS,
    ),
    ...(options.args ?? []),
  ];
  const bundle = await runBun(args, { cwd, env: options.env });
  if (!bundle.success) return { success: false };

  const outDir = options.outputPath
    ? abs(context.root, options.outputPath)
    : dirname(abs(context.root, options.outfile as string));

  if (options.dts && !(await emitDeclarations(options, context, outDir))) {
    return { success: false };
  }
  if (options.generatePackageJson) writePackageJson(options, context, outDir);
  if (options.assets?.length) copyAssets(options.assets, context.root, outDir);
  return { success: true };
}

const abs = (root: string, p: string) => (isAbsolute(p) ? p : join(root, p));

async function emitDeclarations(
  options: BuildExecutorOptions,
  context: ExecutorContext,
  outDir: string,
): Promise<boolean> {
  let tsc: string;
  try {
    tsc = require.resolve('typescript/bin/tsc', { paths: [context.root] });
  } catch {
    console.error(
      '`dts` needs the `typescript` package. Install it with bun add -d typescript.',
    );
    return false;
  }
  const project =
    context.projectsConfigurations?.projects[context.projectName ?? ''];
  const tsConfig =
    options.tsConfig ?? join(project?.root ?? '.', 'tsconfig.json');
  const rootDir = join(project?.root ?? '.', 'src');
  const { success } = await runProcess(
    'node',
    [
      tsc,
      '-p',
      abs(context.root, tsConfig),
      '--declaration',
      '--emitDeclarationOnly',
      '--noEmit',
      'false',
      '--rootDir',
      abs(context.root, rootDir),
      '--outDir',
      outDir,
    ],
    { cwd: context.root, env: options.env },
  );
  return success;
}

function writePackageJson(
  options: BuildExecutorOptions,
  context: ExecutorContext,
  outDir: string,
): void {
  const project =
    context.projectsConfigurations?.projects[context.projectName ?? ''];
  const source = join(context.root, project?.root ?? '.', 'package.json');
  if (!existsSync(source)) {
    throw new Error(`generatePackageJson needs ${source}`);
  }
  const pkg = JSON.parse(readFileSync(source, 'utf8'));
  const { scripts, devDependencies, nx, ...rest } = pkg;

  const mode =
    options.packages === 'external' ? 'all' : (options.external ?? []);
  const deps = filterDependencies(
    collectNpmDependencies(context.projectGraph, context.projectName as string),
    mode,
  );
  const out = {
    ...rest,
    private: undefined,
    dependencies: { ...rest.dependencies, ...deps },
  };
  if (!Object.keys(out.dependencies).length)
    delete (out as Record<string, unknown>).dependencies;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'package.json'),
    JSON.stringify(out, null, 2) + '\n',
  );
}

function copyAssets(assets: string[], root: string, outDir: string): void {
  for (const asset of assets) {
    const from = abs(root, asset);
    if (!existsSync(from)) throw new Error(`Asset not found: ${asset}`);
    cpSync(from, join(outDir, from.split(/[\\/]/).pop() as string), {
      recursive: true,
    });
  }
}
