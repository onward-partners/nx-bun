import {
  type ExecutorContext,
  parseTargetString,
  readTargetOptions,
} from '@nx/devkit';
import { existsSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import { resolveCwd, runBun, runProcess } from '../../utils/run-bun';
import type { BuildExecutorOptions } from '../build/executor';

export interface RunExecutorOptions {
  /** Run TypeScript/JavaScript source directly with Bun. */
  main?: string;
  /** Run the compiled output of a `@onward-partners/nx-bun:build` target, e.g. `myapp:bun-build`. */
  buildTarget?: string;
  /** Runtime for compiled JS output. Ignored for `--compile` executables. */
  runtime?: 'bun' | 'node';
  /** Overrides the file derived from the build target. */
  outputFile?: string;
  cwd?: string;
  watch?: boolean;
  hot?: boolean;
  env?: Record<string, string>;
  args?: string[];
  bunArgs?: string[];
}

/** Work out which file the build target produces. */
export function resolveBuiltFile(
  build: BuildExecutorOptions,
  root: string,
  override?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const abs = (p: string) => (isAbsolute(p) ? p : join(root, p));
  if (override) return abs(override);
  if (build.outfile) {
    // bun build --compile appends .exe on Windows when no extension is given.
    const needsExe =
      build.compile && platform === 'win32' && !extname(build.outfile);
    return abs(needsExe ? build.outfile + '.exe' : build.outfile);
  }
  if (!build.outputPath || !build.entryPoints?.length) {
    throw new Error(
      'The build target needs `outputPath` and `entryPoints` (or `outfile`) so the output file can be found. Set `outputFile` to override.',
    );
  }
  const entry = build.entryPoints[0];
  const name = basename(entry, extname(entry));
  return join(abs(build.outputPath), `${name}.js`);
}

export default async function runExecutor(
  options: RunExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  if (!options.main && !options.buildTarget) {
    throw new Error(
      'Set either `main` (run source) or `buildTarget` (run compiled output).',
    );
  }
  if (options.main && options.buildTarget) {
    throw new Error('Use either `main` or `buildTarget`, not both.');
  }
  const cwd = resolveCwd(context, options.cwd, 'workspace');
  const scriptArgs = options.args ?? [];

  // Mode 1: run the TypeScript/JavaScript source directly.
  if (options.main) {
    const args: string[] = [];
    if (options.hot) args.push('--hot');
    else if (options.watch) args.push('--watch');
    args.push(...(options.bunArgs ?? []), 'run', options.main, ...scriptArgs);
    const { success } = await runBun(args, { cwd, env: options.env });
    return { success };
  }

  // Mode 2: run the compiled output of a build target.
  const target = parseTargetString(options.buildTarget!, context);
  const build = readTargetOptions<BuildExecutorOptions>(target, context);
  const file = resolveBuiltFile(build, context.root, options.outputFile);
  if (!existsSync(file)) {
    throw new Error(
      `Build output not found: ${file}. Run "${options.buildTarget}" first or add it to dependsOn.`,
    );
  }

  if (build.compile) {
    const { success } = await runProcess(file, scriptArgs, {
      cwd,
      env: options.env,
    });
    return { success };
  }
  if (options.runtime === 'node') {
    const { success } = await runProcess('node', [file, ...scriptArgs], {
      cwd,
      env: options.env,
    });
    return { success };
  }
  const args: string[] = [];
  if (options.hot) args.push('--hot');
  else if (options.watch) args.push('--watch');
  args.push(...(options.bunArgs ?? []), 'run', file, ...scriptArgs);
  const { success } = await runBun(args, { cwd, env: options.env });
  return { success };
}
// bun build --compile appends .exe on Windows when no extension is given.
