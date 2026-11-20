import {
  type ExecutorContext,
  parseTargetString,
  readTargetOptions,
} from '@nx/devkit';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { collectNpmDependencies } from '../../utils/dependencies';
import { runBun } from '../../utils/run-bun';
import type { BuildExecutorOptions } from '../build/executor';

export interface PruneLockfileExecutorOptions {
  /** Directory that receives package.json and bun.lock. */
  outputPath?: string;
  /** Build target whose output directory is used when `outputPath` is not set. */
  buildTarget?: string;
  /** Write exact versions from the workspace lockfile instead of ranges. */
  exactVersions?: boolean;
  env?: Record<string, string>;
}

const abs = (root: string, p: string) => (isAbsolute(p) ? p : join(root, p));

/**
 * Bun counterpart of `@nx/js:prune-lockfile`, which cannot generate Bun
 * lockfiles. It pins the project's npm dependencies to the versions Nx read
 * from the workspace bun.lock and lets `bun install --lockfile-only`
 * produce a bun.lock for exactly those packages.
 */
export default async function pruneLockfileExecutor(
  options: PruneLockfileExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const projectName = context.projectName as string;
  const outDir = resolveOutDir(options, context);
  const project = context.projectsConfigurations?.projects[projectName];
  const sourcePkg = join(context.root, project?.root ?? '.', 'package.json');

  const pkgPath = join(outDir, 'package.json');
  const base = existsSync(pkgPath)
    ? readJson(pkgPath)
    : existsSync(sourcePkg)
      ? stripDevTooling(readJson(sourcePkg))
      : { name: projectName, version: '0.0.0' };

  const exact = collectNpmDependencies(context.projectGraph, projectName);
  const declared = (base.dependencies ?? {}) as Record<string, string>;
  const names = new Set([...Object.keys(declared), ...Object.keys(exact)]);
  const deps: Record<string, string> = {};
  for (const name of [...names].sort()) {
    deps[name] =
      options.exactVersions === false
        ? (declared[name] ?? exact[name])
        : (exact[name] ?? declared[name]);
  }

  const pkg: Record<string, unknown> = { ...base };
  if (Object.keys(deps).length) pkg.dependencies = deps;
  else delete pkg.dependencies;

  mkdirSync(dirname(pkgPath), { recursive: true });
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  const { success } = await runBun(
    ['install', '--lockfile-only', '--ignore-scripts'],
    {
      cwd: outDir,
      env: options.env,
    },
  );
  if (!success) return { success: false };

  if (!existsSync(join(outDir, 'bun.lock'))) {
    console.error(
      `bun did not write ${join(outDir, 'bun.lock')}. Is the installed Bun older than 1.4?`,
    );
    return { success: false };
  }
  return { success: true };
}

function resolveOutDir(
  options: PruneLockfileExecutorOptions,
  context: ExecutorContext,
): string {
  if (options.outputPath) return abs(context.root, options.outputPath);
  const buildTarget = options.buildTarget ?? `${context.projectName}:bun-build`;
  const build = readTargetOptions<BuildExecutorOptions>(
    parseTargetString(buildTarget, context),
    context,
  );
  if (build.outputPath) return abs(context.root, build.outputPath);
  if (build.outfile) return dirname(abs(context.root, build.outfile));
  throw new Error(
    `Cannot determine the output directory from ${buildTarget}. Set \`outputPath\`.`,
  );
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stripDevTooling(pkg: Record<string, any>): Record<string, any> {
  const { scripts, devDependencies, nx, ...rest } = pkg;
  return rest;
}
