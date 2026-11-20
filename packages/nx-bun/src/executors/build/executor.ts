import type { ExecutorContext } from '@nx/devkit';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import {
  BUILD_CONFIG_ENV,
  BUILD_SCRIPT,
  type BunBuildApiConfig,
  defineToObject,
} from '../../utils/bun-build-api';
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
  /**
   * Bun plugins for `Bun.build()`: paths to modules (relative to the workspace
   * root or cwd) whose default export is a BunPlugin, an array of them, or a
   * function returning either. `bun build` has no plugin flag, so the build
   * then runs through the JavaScript API; `args` is not supported in that mode.
   */
  plugins?: string[];
  /** Empty the output (`outputPath`, or the `outfile`) before building. */
  clean?: boolean;
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
  if (options.clean) clean(options, context.root);

  const bundle = options.plugins?.length
    ? await buildWithPlugins(options, cwd)
    : await buildWithCli(options, cwd);
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

function clean(options: BuildExecutorOptions, root: string): void {
  // `outfile` wins over `outputPath`, as in the build itself.
  const target = options.outfile ?? options.outputPath;
  const path = abs(root, target as string);
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `Refusing to clean ${path}: it must be inside the workspace and not its root.`,
    );
  }
  rmSync(path, { recursive: true, force: true });
}

function buildWithCli(options: BuildExecutorOptions, cwd: string) {
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
  return runBun(args, { cwd, env: options.env });
}

function buildWithPlugins(options: BuildExecutorOptions, cwd: string) {
  if (options.args?.length) {
    throw new Error(
      '`args` cannot be combined with `plugins`: raw CLI flags do not apply to Bun.build(). Use the typed options.',
    );
  }
  const config: Record<string, unknown> = {
    entrypoints: options.entryPoints,
    target: options.target,
    format: options.format,
    minify: options.minify,
    sourcemap: options.sourcemap,
    splitting: options.splitting,
    packages: options.packages,
    external: options.external,
    define: options.define ? defineToObject(options.define) : undefined,
  };
  if (options.outfile) {
    // Bun.build() has no `outfile`: write into its folder under that name.
    const file = abs(cwd, options.outfile);
    config.outdir = dirname(file);
    config.naming = basename(file);
  } else {
    config.outdir = options.outputPath;
  }
  if (options.compile) config.compile = true;
  const payload: BunBuildApiConfig = {
    plugins: options.plugins!.map(p => abs(cwd, p)),
    config,
  };
  console.log(`> bun build (Bun.build API, ${payload.plugins.length} plugin(s))`);
  // A temp file, not `bun -e`: the script spans lines, which a Windows shell
  // fallback would mangle.
  const dir = mkdtempSync(join(tmpdir(), 'nx-bun-build-'));
  const script = join(dir, 'build.mjs');
  writeFileSync(script, BUILD_SCRIPT);
  return runBun(['run', script], {
    cwd,
    env: { ...options.env, [BUILD_CONFIG_ENV]: JSON.stringify(payload) },
  }).finally(() => rmSync(dir, { recursive: true, force: true }));
}

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
