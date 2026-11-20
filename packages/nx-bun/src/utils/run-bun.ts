import type { ExecutorContext } from '@nx/devkit';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export interface RunBunOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
}

export interface RunResult {
  success: boolean;
  code: number | null;
}

const isWindows = process.platform === 'win32';

/** Resolve a user supplied cwd against the workspace root. */
export function resolveCwd(
  context: ExecutorContext,
  cwd: string | undefined,
  fallback: 'workspace' | 'project',
): string {
  if (cwd) {
    return isAbsolute(cwd) ? cwd : join(context.root, cwd);
  }
  if (fallback === 'project') {
    const root =
      context.projectsConfigurations?.projects[context.projectName ?? '']?.root;
    return root ? join(context.root, root) : context.root;
  }
  return context.root;
}

/**
 * On Windows, expand 8.3 short names (C:\Users\RUNNER~1, C:\Users\FIRSTN~1)
 * to the long form. Bun gives `import.meta.main` as `false` when the working
 * directory is a short path, so a project that checks it prints nothing.
 * Other platforms are left alone: resolving symlinks there could change what
 * users see as their workspace.
 */
export function normalizeCwd(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return cwd;
  try {
    return realpathSync.native(cwd);
  } catch {
    return cwd;
  }
}

/**
 * The bun binary to spawn. Inside a Bun process `process.execPath` is Bun
 * itself; otherwise `BUN_BIN`, then `bun` from PATH.
 */
export function bunBinary(): string {
  if (process.env.BUN_BIN) return process.env.BUN_BIN;
  if (process.versions.bun) return process.execPath;
  return 'bun';
}

/** Terminate a child and everything it started. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.killed) return;
  if (isWindows) {
    // `child.kill()` only ends the direct child on Windows.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    try {
      // The child leads its own process group (see `detached` below).
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

export function runBun(
  args: string[],
  options: RunBunOptions,
): Promise<RunResult> {
  return runProcess(bunBinary(), args, options);
}

/**
 * Spawn any command with inherited stdio. Works for `bun` and for compiled
 * binaries. The child is terminated when Nx stops the task.
 */
export function runProcess(
  command: string,
  args: string[],
  { cwd, env }: RunBunOptions,
): Promise<RunResult> {
  console.log(
    `> ${command === bunBinary() ? 'bun' : command} ${args.join(' ')}`,
  );
  return new Promise(resolve => {
    let settled = false;
    const start = (shell: boolean) => {
      const child = spawn(command, args, {
        cwd: normalizeCwd(cwd),
        env: { ...process.env, FORCE_COLOR: 'true', ...env },
        stdio: 'inherit',
        windowsHide: true,
        shell,
        // Own process group on POSIX so killTree can signal the whole tree.
        detached: !isWindows,
      });

      const stop = () => killTree(child);
      const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
      for (const s of signals) process.once(s, stop);
      process.once('exit', stop);
      const cleanup = () => {
        for (const s of signals) process.off(s, stop);
        process.off('exit', stop);
      };

      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ success: code === 0, code });
      };

      child.on('error', (err: NodeJS.ErrnoException) => {
        cleanup();
        // npm-installed `bun` is a .cmd shim on Windows; retry through a shell.
        if (err.code === 'ENOENT' && isWindows && !shell) {
          start(true);
          return;
        }
        console.error(
          err.code === 'ENOENT'
            ? `Could not find \`${command}\`${
                command === bunBinary()
                  ? '. Install Bun from https://bun.sh or set BUN_BIN'
                  : ''
              }.`
            : `Failed to start ${command}: ${err.message}`,
        );
        finish(1);
      });
      child.on('exit', (code, signal) => finish(code ?? (signal ? 1 : 0)));
    };
    start(false);
  });
}

export type Flag = { flag: string; kind: 'bool' | 'value' | 'list' };

/** Translate an options object into CLI flags using a declarative table. */
export function toFlags(
  options: Record<string, unknown>,
  table: Record<string, Flag>,
): string[] {
  const out: string[] = [];
  for (const [key, spec] of Object.entries(table)) {
    const value = options[key];
    if (value === undefined || value === null || value === false) continue;
    if (spec.kind === 'bool') {
      if (value === true) out.push(spec.flag);
    } else if (spec.kind === 'list') {
      for (const item of value as string[]) out.push(spec.flag, String(item));
    } else {
      out.push(`${spec.flag}=${String(value)}`);
    }
  }
  return out;
}

/** Normalise to forward slashes for display and cross-platform comparisons. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}
