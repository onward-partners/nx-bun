import {
  type CreateNodesV2,
  type TargetConfiguration,
  createNodesFromFiles,
} from '@nx/devkit';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** A target name, or `false` to not infer that target. */
export type TargetName = string | false;

export interface BunPluginOptions {
  testTargetName?: TargetName;
  fmtTargetName?: TargetName;
  fmtCheckTargetName?: TargetName;
  buildTargetName?: TargetName;
  serveTargetName?: TargetName;
  startTargetName?: TargetName;
  pruneLockfileTargetName?: TargetName;
  /** Infer `nx-release-publish` (runs `bun publish`) for non-private projects. Default true. */
  releasePublish?: boolean;
  /** Only infer targets for projects whose root matches one of these globs. */
  include?: string[];
  /** Never infer targets for projects whose root matches one of these globs. */
  exclude?: string[];
  /** Also treat a `bunfig.toml` in the workspace root as a project. Default false. */
  rootProject?: boolean;
}

const PLUGIN = '@onward-partners/nx-bun';
const ENTRY_CANDIDATES = [
  'src/index.ts',
  'src/main.ts',
  'index.ts',
  'src/index.js',
  'src/main.js',
];
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', 'tmp']);

// Cache inputs: a Bun upgrade or a different NODE_ENV can change task results.
const BUN_VERSION = { runtime: 'bun --version' };
const NODE_ENV = { env: 'NODE_ENV' };

/**
 * A directory is a Bun project when it holds a `bunfig.toml` next to a
 * `package.json` or `project.json`. The workspace root is skipped unless
 * `rootProject` is set: a root `bunfig.toml` usually only configures installs.
 */
export const createNodesV2: CreateNodesV2<BunPluginOptions> = [
  '**/bunfig.toml',
  async (files, options, context) =>
    createNodesFromFiles(
      file => {
        const root = dirname(file);
        if (root === '.' && !options?.rootProject) return {};
        if (!isSelected(root, options)) return {};
        const abs = (p: string) => join(context.workspaceRoot, root, p);
        const hasPkg = existsSync(abs('package.json'));
        if (!hasPkg && !existsSync(abs('project.json'))) return {};

        const name = (configured: TargetName | undefined, fallback: string) =>
          configured === undefined ? fallback : configured;
        const names = {
          test: name(options?.testTargetName, 'bun-test'),
          fmt: name(options?.fmtTargetName, 'bun-fmt'),
          fmtCheck: name(options?.fmtCheckTargetName, 'bun-fmt-check'),
          build: name(options?.buildTargetName, 'bun-build'),
          serve: name(options?.serveTargetName, 'bun-serve'),
          start: name(options?.startTargetName, 'bun-start'),
          prune: name(options?.pruneLockfileTargetName, 'bun-prune-lockfile'),
        };
        const pkg = hasPkg ? readJson(abs('package.json')) : undefined;
        const projectName = readProjectName(abs, root);
        const isPublishable = !!pkg && pkg.private !== true;
        const targets: Record<string, TargetConfiguration> = {};
        const meta = (description: string) => ({
          technologies: ['bun'],
          description,
        });

        if (names.test && hasTestFiles(abs('.'))) {
          targets[names.test] = {
            executor: `${PLUGIN}:test`,
            cache: true,
            inputs: ['default', '^default', BUN_VERSION, NODE_ENV],
            outputs: ['{projectRoot}/coverage'],
            options: {},
            metadata: meta('Run tests with bun test'),
          };
        }

        if (names.fmt) {
          targets[names.fmt] = {
            executor: `${PLUGIN}:fmt`,
            cache: false,
            options: {},
            metadata: meta('Format with bun fmt'),
          };
        }
        if (names.fmtCheck) {
          targets[names.fmtCheck] = {
            executor: `${PLUGIN}:fmt`,
            cache: true,
            inputs: ['default', BUN_VERSION],
            options: { check: true },
            metadata: meta('Check formatting with bun fmt --check'),
          };
        }

        const entry = ENTRY_CANDIDATES.find(e => existsSync(abs(e)));
        if (entry) {
          const buildOptions: Record<string, unknown> = {
            entryPoints: [`${root}/${entry}`],
            outputPath: `dist/${root}`,
            target: isPublishable ? 'node' : 'bun',
          };
          if (isPublishable) {
            buildOptions.packages = 'external';
            buildOptions.generatePackageJson = true;
            buildOptions.dts = existsSync(abs('tsconfig.json'));
          }
          // Bun and NODE_ENV change the bundle; tsc changes the declarations.
          // No dependsOn: bun bundles workspace libraries from source.
          const buildInputs: TargetConfiguration['inputs'] = [
            'default',
            '^default',
            BUN_VERSION,
            NODE_ENV,
          ];
          if (buildOptions.dts)
            buildInputs.push({ externalDependencies: ['typescript'] });
          if (names.build) {
            targets[names.build] = {
              executor: `${PLUGIN}:build`,
              cache: true,
              inputs: buildInputs,
              outputs: ['{options.outputPath}', '{options.outfile}'],
              options: buildOptions,
              metadata: meta('Bundle with bun build'),
            };
          }

          // Run the TypeScript source directly (watch mode, no build step).
          if (names.serve) {
            targets[names.serve] = {
              executor: `${PLUGIN}:run`,
              continuous: true,
              cache: false,
              options: { main: `${root}/${entry}`, watch: true },
              metadata: meta('Run source with bun --watch'),
            };
          }
          // Run the compiled output; builds first. Needs the build target.
          if (names.start && names.build) {
            targets[names.start] = {
              executor: `${PLUGIN}:run`,
              cache: false,
              dependsOn: [names.build],
              options: { buildTarget: `${projectName}:${names.build}` },
              metadata: meta('Build, then run compiled output'),
            };
          }
          if (!isPublishable && names.prune && names.build) {
            targets[names.prune] = {
              executor: `${PLUGIN}:prune-lockfile`,
              cache: true,
              dependsOn: [names.build],
              // No {workspaceRoot}/bun.lock: Nx already hashes the project's own
              // external dependencies, and the whole lockfile would invalidate
              // every app whenever any unrelated root dependency changes.
              inputs: ['default', '^default', BUN_VERSION],
              outputs: [
                '{workspaceRoot}/dist/' + root + '/package.json',
                '{workspaceRoot}/dist/' + root + '/bun.lock',
              ],
              options: { buildTarget: `${projectName}:${names.build}` },
              metadata: meta(
                'Create a pruned package.json and bun.lock for deployments',
              ),
            };
          }

          if (isPublishable && options?.releasePublish !== false) {
            targets['nx-release-publish'] = {
              // @nx/js:release-publish passes --json to `bun publish`, which
              // Bun rejects, so the plugin ships its own executor.
              executor: `${PLUGIN}:release-publish`,
              dependsOn: [
                ...(names.build ? [names.build] : []),
                '^nx-release-publish',
              ],
              options: { packageRoot: `dist/${root}` },
            };
          }
        }

        return { projects: { [root]: { root, targets } } };
      },
      files,
      options,
      context,
    ),
];

/** Convert a glob (`*`, `**`, `?`) to a RegExp matching a whole path. */
export function globToRegExp(glob: string): RegExp {
  const g = glob
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Apply the `include` / `exclude` plugin options to a project root. */
export function isSelected(root: string, options?: BunPluginOptions): boolean {
  const matches = (globs: string[]) =>
    globs.some(g => globToRegExp(g).test(root));
  if (options?.include?.length && !matches(options.include)) return false;
  if (options?.exclude?.length && matches(options.exclude)) return false;
  return true;
}

function readJson(path: string): Record<string, any> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The name Nx uses for the project: project.json name, else package.json name, else folder. */
export function readProjectName(
  abs: (p: string) => string,
  root: string,
): string {
  for (const file of ['project.json', 'package.json']) {
    const name = readJson(abs(file))?.name;
    if (typeof name === 'string' && name) return name;
  }
  return basename(root);
}

function hasTestFiles(dir: string, depth = 0): boolean {
  if (depth > 4) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile() && TEST_FILE.test(e.name)) return true;
    if (
      e.isDirectory() &&
      !IGNORED_DIRS.has(e.name) &&
      !e.name.startsWith('.')
    ) {
      if (hasTestFiles(join(dir, e.name), depth + 1)) return true;
    }
  }
  return false;
}
