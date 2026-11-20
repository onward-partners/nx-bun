import { ExecutorContext } from '@nx/devkit';
import { resolveCwd, runBun, toFlags } from '../../utils/run-bun';

export interface FmtExecutorOptions {
  files?: string[];
  cwd?: string;
  check?: boolean;
  printWidth?: number;
  useTabs?: boolean;
  noSemi?: boolean;
  singleQuote?: boolean;
  changed?: string | boolean;
  noScript?: boolean;
  env?: Record<string, string>;
  args?: string[];
}

const FLAGS = {
  printWidth: { flag: '--print-width', kind: 'value' },
  check: { flag: '--check', kind: 'bool' },
  useTabs: { flag: '--use-tabs', kind: 'bool' },
  noSemi: { flag: '--no-semi', kind: 'bool' },
  singleQuote: { flag: '--single-quote', kind: 'bool' },
  noScript: { flag: '--no-script', kind: 'bool' },
} as const;

export default async function fmtExecutor(
  options: FmtExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args = [
    'fmt',
    ...toFlags(options as unknown as Record<string, unknown>, FLAGS),
  ];
  if (options.changed === true) args.push('--changed');
  else if (typeof options.changed === 'string') {
    args.push(`--changed=${options.changed}`);
  }
  args.push(
    ...(options.args ?? []),
    ...(options.files?.length ? options.files : ['.']),
  );

  const { success } = await runBun(args, {
    cwd: resolveCwd(context, options.cwd, 'project'),
    env: options.env,
  });
  return { success };
}
