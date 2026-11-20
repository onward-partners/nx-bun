import { ExecutorContext } from '@nx/devkit';
import { resolveCwd, runBun, toFlags } from '../../utils/run-bun';

export interface CheckExecutorOptions {
  files?: string[];
  cwd?: string;
  project?: string;
  build?: boolean;
  pretty?: boolean;
  all?: boolean;
  threads?: number;
  timing?: boolean;
  noScript?: boolean;
  env?: Record<string, string>;
  args?: string[];
}

const FLAGS = {
  project: { flag: '--project', kind: 'value' },
  threads: { flag: '--threads', kind: 'value' },
  build: { flag: '--build', kind: 'bool' },
  all: { flag: '--all', kind: 'bool' },
  timing: { flag: '--timing', kind: 'bool' },
  noScript: { flag: '--no-script', kind: 'bool' },
} as const;

export default async function checkExecutor(
  options: CheckExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args = [
    'check',
    ...toFlags(options as unknown as Record<string, unknown>, FLAGS),
  ];
  if (options.pretty === true) args.push('--pretty');
  else if (options.pretty === false) args.push('--no-pretty');
  args.push(...(options.args ?? []), ...(options.files ?? []));

  const { success } = await runBun(args, {
    cwd: resolveCwd(context, options.cwd, 'project'),
    env: options.env,
  });
  return { success };
}
