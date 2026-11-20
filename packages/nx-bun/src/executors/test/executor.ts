import { ExecutorContext } from '@nx/devkit';
import { resolveCwd, runBun, toFlags } from '../../utils/run-bun';

export interface TestExecutorOptions {
  testFiles?: string[];
  cwd?: string;
  timeout?: number;
  bail?: number | boolean;
  coverage?: boolean;
  coverageReporter?: string[];
  coverageDir?: string;
  updateSnapshots?: boolean;
  watch?: boolean;
  testNamePattern?: string;
  reporter?: 'junit' | 'dots';
  reporterOutfile?: string;
  passWithNoTests?: boolean;
  concurrent?: boolean;
  randomize?: boolean;
  only?: boolean;
  env?: Record<string, string>;
  args?: string[];
}

const FLAGS = {
  timeout: { flag: '--timeout', kind: 'value' },
  coverageDir: { flag: '--coverage-dir', kind: 'value' },
  testNamePattern: { flag: '--test-name-pattern', kind: 'value' },
  reporter: { flag: '--reporter', kind: 'value' },
  reporterOutfile: { flag: '--reporter-outfile', kind: 'value' },
  coverageReporter: { flag: '--coverage-reporter', kind: 'list' },
  coverage: { flag: '--coverage', kind: 'bool' },
  updateSnapshots: { flag: '--update-snapshots', kind: 'bool' },
  watch: { flag: '--watch', kind: 'bool' },
  passWithNoTests: { flag: '--pass-with-no-tests', kind: 'bool' },
  concurrent: { flag: '--concurrent', kind: 'bool' },
  randomize: { flag: '--randomize', kind: 'bool' },
  only: { flag: '--only', kind: 'bool' },
} as const;

export default async function testExecutor(
  options: TestExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const args = [
    'test',
    ...toFlags(options as unknown as Record<string, unknown>, FLAGS),
  ];
  if (options.bail === true) args.push('--bail');
  else if (typeof options.bail === 'number')
    args.push(`--bail=${options.bail}`);
  args.push(...(options.args ?? []), ...(options.testFiles ?? []));

  const { success } = await runBun(args, {
    cwd: resolveCwd(context, options.cwd, 'project'),
    env: options.env,
  });
  return { success };
}
