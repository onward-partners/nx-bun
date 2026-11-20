import type { ExecutorContext } from '@nx/devkit';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { runBun, toFlags } from '../../utils/run-bun';

export interface ReleasePublishExecutorOptions {
  /** Directory holding the built package (with its package.json). */
  packageRoot?: string;
  registry?: string;
  tag?: string;
  access?: 'public' | 'restricted';
  otp?: string;
  dryRun?: boolean;
  /** Do not fail when this version is already published. Default true. */
  tolerateRepublish?: boolean;
  /** Passed by `nx release`; Bun needs no special handling for it. */
  firstRelease?: boolean;
  env?: Record<string, string>;
  args?: string[];
}

const FLAGS = {
  registry: { flag: '--registry', kind: 'value' },
  tag: { flag: '--tag', kind: 'value' },
  access: { flag: '--access', kind: 'value' },
  otp: { flag: '--otp', kind: 'value' },
  dryRun: { flag: '--dry-run', kind: 'bool' },
  tolerateRepublish: { flag: '--tolerate-republish', kind: 'bool' },
} as const;

/**
 * Publish with `bun publish`. `@nx/js:release-publish` adds `--json`, which
 * Bun does not know, so `nx release publish` needs this executor instead.
 */
export default async function releasePublishExecutor(
  options: ReleasePublishExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const project =
    context.projectsConfigurations?.projects[context.projectName ?? ''];
  const packageRoot = options.packageRoot ?? project?.root;
  if (!packageRoot) throw new Error('`packageRoot` is required.');
  const cwd = isAbsolute(packageRoot)
    ? packageRoot
    : join(context.root, packageRoot);
  if (!existsSync(join(cwd, 'package.json'))) {
    throw new Error(
      `No package.json in ${cwd}. Build the project first (add its build target to dependsOn).`,
    );
  }

  const { success } = await runBun(publishArgs(options), {
    cwd,
    env: options.env,
  });
  return { success };
}

/** The `bun publish` arguments. Never includes `--json`. */
export function publishArgs(options: ReleasePublishExecutorOptions): string[] {
  return [
    'publish',
    ...toFlags(
      { tolerateRepublish: true, ...options } as Record<string, unknown>,
      FLAGS,
    ),
    ...(options.args ?? []),
  ];
}
