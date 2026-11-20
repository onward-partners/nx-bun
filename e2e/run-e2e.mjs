// End-to-end test: fresh workspace + built plugin, real bun and nx.
// Usage: node e2e/run-e2e.mjs   (build the plugin first: cd packages/nx-bun && bun run build)
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDist = resolve(here, '../packages/nx-bun/dist');
const NX = process.env.E2E_NX_VERSION ?? '24.0.6';
const keep = process.env.E2E_KEEP === '1';
const isWin = process.platform === 'win32';

if (!existsSync(join(pluginDist, 'package.json'))) {
  console.error('Build the plugin first: cd packages/nx-bun && bun run build');
  process.exit(2);
}

const ws = mkdtempSync(join(tmpdir(), 'nx-bun-e2e-'));
const env = {
  ...process.env,
  NX_DAEMON: 'false',
  CI: 'true',
  NX_NO_CLOUD: 'true',
  FORCE_COLOR: '0',
};
const results = [];

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ws,
    env,
    encoding: 'utf8',
    shell: isWin,
    ...opts,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const nx = (...args) => sh('bunx', ['nx', ...args, '--output-style=static']);
const read = p => readFileSync(join(ws, p), 'utf8');
const json = p => JSON.parse(read(p));

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  PASS ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, error: e.message });
    console.log(
      `  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`,
    );
  }
}
function ok(r, what) {
  if (r.code !== 0)
    throw new Error(`${what} exited ${r.code}\n${r.out.slice(-1500)}`);
  return r.out;
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log(
  `workspace: ${ws}\nnx ${NX} · bun ${sh('bun', ['--version']).out.trim()} · ${process.platform}/${process.arch}\n`,
);

writeFileSync(
  join(ws, 'package.json'),
  JSON.stringify(
    {
      name: '@e2e/source',
      private: true,
      devDependencies: {
        nx: NX,
        '@nx/devkit': NX,
        '@nx/js': NX,
        typescript: '6.0.3',
        tslib: '^2.6.0',
        '@onward-partners/nx-bun': `file:${pluginDist.replace(/\\/g, '/')}`,
      },
    },
    null,
    2,
  ),
);
writeFileSync(
  join(ws, 'nx.json'),
  JSON.stringify({
    cli: { packageManager: 'bun' },
    namedInputs: { default: ['{projectRoot}/**/*'] },
  }),
);
writeFileSync(
  join(ws, 'tsconfig.base.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
      paths: {},
    },
  }),
);
writeFileSync(join(ws, '.gitignore'), 'node_modules\ndist\n.nx\ncoverage\n');

await step('bun install', () => ok(sh('bun', ['install']), 'bun install'));
await step('init generator registers plugin', () => {
  ok(nx('g', '@onward-partners/nx-bun:init', '--no-interactive'), 'init');
  assert(
    json('nx.json').plugins.some(p => p.plugin === '@onward-partners/nx-bun'),
    'plugin missing in nx.json',
  );
});
await step('application generator', () => {
  ok(
    nx('g', '@onward-partners/nx-bun:application', 'api', '--no-interactive'),
    'app generator',
  );
  assert(existsSync(join(ws, 'apps/api/src/main.ts')), 'main.ts missing');
});
await step('library generator (source-linked)', () => {
  ok(
    nx(
      'g',
      '@onward-partners/nx-bun:library',
      'util',
      '--importPath=@e2e/util',
      '--no-interactive',
    ),
    'lib generator',
  );
  assert(
    json('tsconfig.base.json').compilerOptions.paths['@e2e/util'],
    'path alias missing',
  );
});
await step('library generator (publishable)', () => {
  ok(
    nx(
      'g',
      '@onward-partners/nx-bun:library',
      'ui',
      '--importPath=@e2e/ui',
      '--publishable',
      '--no-interactive',
    ),
    'publishable lib',
  );
});
await step('bun install after generators', () =>
  ok(sh('bun', ['install']), 'bun install'),
);

await step('inferred targets present', () => {
  const p = JSON.parse(
    ok(nx('show', 'project', 'api', '--json'), 'show project').replace(
      /^[^{]*/,
      '',
    ),
  );
  for (const t of [
    'bun-test',
    'bun-build',
    'bun-serve',
    'bun-start',
    'bun-fmt',
    'bun-fmt-check',
    'bun-prune-lockfile',
  ])
    assert(p.targets[t], `missing target ${t}`);
});
await step('bun-test (app and libs)', () => {
  const out = ok(nx('run-many', '-t', 'bun-test'), 'bun-test');
  assert(/3 pass|pass/.test(out), 'no passing tests reported');
});
await step('bun-fmt then bun-fmt-check', () => {
  ok(nx('run-many', '-t', 'bun-fmt'), 'bun-fmt');
  ok(nx('run-many', '-t', 'bun-fmt-check', '--skip-nx-cache'), 'bun-fmt-check');
});
await step('bun-fmt-check fails on unformatted code', () => {
  writeFileSync(
    join(ws, 'apps/api/src/ugly.ts'),
    'export const   x  =   {a:1,b:2}',
  );
  const r = nx('run', 'api:bun-fmt-check', '--skip-nx-cache');
  assert(r.code !== 0, 'expected failure for unformatted file');
  ok(nx('run', 'api:bun-fmt'), 'format');
});
await step('bun-build app', () => {
  ok(nx('run', 'api:bun-build'), 'build');
  assert(
    existsSync(join(ws, 'dist/apps/api/main.js')),
    'dist/apps/api/main.js missing',
  );
});
await step('bun-start runs compiled output', () => {
  const out = ok(nx('run', 'api:bun-start', '--args=Compiled'), 'start');
  assert(
    out.includes('Hello Compiled from api'),
    `unexpected output\n${out.slice(-600)}`,
  );
});
await step('bun-start with runtime=node', () => {
  const out = ok(
    nx('run', 'api:bun-start', '--runtime=node', '--args=Node'),
    'start node',
  );
  assert(out.includes('Hello Node from api'), 'node runtime output missing');
});
await step('run source directly (main)', () => {
  const out = ok(
    nx('run', 'api:bun-serve', '--watch=false', '--args=Src'),
    'run source',
  );
  assert(out.includes('Hello Src from api'), 'source run output missing');
});
await step('publishable lib build: js + d.ts + package.json', () => {
  ok(nx('run', '@e2e/ui:bun-build'), 'build ui');
  for (const f of ['index.js', 'index.d.ts', 'package.json'])
    assert(
      existsSync(join(ws, 'dist/libs/ui', f)),
      `dist/libs/ui/${f} missing`,
    );
  assert(
    json('dist/libs/ui/package.json').private === undefined,
    'private flag leaked',
  );
});
await step('compile to standalone executable', () => {
  writeFileSync(
    join(ws, 'apps/api/project.json'),
    JSON.stringify({
      name: 'api',
      targets: {
        'bun-build': {
          configurations: {
            exe: { compile: true, outfile: 'dist/apps/api/api' },
          },
        },
        'bun-start': {
          configurations: { exe: { buildTarget: 'api:bun-build:exe' } },
        },
      },
    }),
  );
  const out = ok(nx('run', 'api:bun-start:exe', '--args=Exe'), 'start exe');
  assert(out.includes('Hello Exe from api'), 'compiled exe output missing');
});

await step('prune-lockfile pins deps and writes bun.lock', () => {
  rmSync(join(ws, 'apps/api/project.json'), { force: true });
  ok(sh('bun', ['add', 'zod@3.23.8']), 'bun add zod');
  writeFileSync(
    join(ws, 'apps/api/src/main.ts'),
    `import { z } from 'zod';\nexport function hello(name = 'world'): string {\n  return \`Hello \${z.string().parse(name)} from api\`;\n}\n\nif (import.meta.main) {\n  console.log(hello(process.argv[2]));\n}\n`,
  );
  ok(nx('reset'), 'nx reset');
  ok(nx('run', 'api:bun-prune-lockfile', '--skip-nx-cache'), 'prune-lockfile');
  const lock = join(ws, 'dist/apps/api/bun.lock');
  assert(existsSync(lock), 'pruned bun.lock missing');
  const pkg = json('dist/apps/api/package.json');
  assert(
    pkg.dependencies?.zod === '3.23.8',
    `zod not pinned: ${JSON.stringify(pkg.dependencies)}`,
  );
  const text = readFileSync(lock, 'utf8');
  assert(
    text.includes('zod') && !text.includes('typescript'),
    'pruned lockfile has wrong content',
  );
});

// Cache status of one task: its "> nx run <task>" line carries "[local cache]" on a hit.
const cacheStatus = (task, env2 = {}) => {
  const r = spawnSync('bunx', ['nx', 'run', task, '--output-style=static'], {
    cwd: ws,
    env: { ...env, ...env2 },
    encoding: 'utf8',
    shell: isWin,
  });
  const out = `${r.stdout}${r.stderr}`;
  if (r.status !== 0) throw new Error(`${task} failed\n${out.slice(-800)}`);
  const line = out.split('\n').find(l => l.includes(`nx run ${task}`)) ?? '';
  return line.includes('local cache') ? 'hit' : 'miss';
};

await step('cache: build hits, restores outputs, reacts to inputs', () => {
  const t = 'api:bun-build';
  cacheStatus(t); // warm
  assert(cacheStatus(t) === 'hit', 'second build should be a cache hit');
  rmSync(join(ws, 'dist/apps/api/main.js'), { force: true });
  assert(
    cacheStatus(t) === 'hit',
    'build should hit after deleting its output',
  );
  assert(
    existsSync(join(ws, 'dist/apps/api/main.js')),
    'cache did not restore main.js',
  );
  assert(
    cacheStatus(t, { NODE_ENV: 'production' }) === 'miss',
    'NODE_ENV change must invalidate the build',
  );
  const file = join(ws, 'apps/api/src/main.ts');
  writeFileSync(file, readFileSync(file, 'utf8') + '\n// cache probe\n');
  assert(cacheStatus(t) === 'miss', 'source change must invalidate the build');
  assert(cacheStatus(t) === 'hit', 'build should hit again after the rebuild');
});
await step(
  'cache: prune-lockfile hits and follows a dependency version change',
  () => {
    const t = 'api:bun-prune-lockfile';
    const pruned = () => json('dist/apps/api/package.json').dependencies.zod;
    cacheStatus(t);
    assert(
      cacheStatus(t) === 'hit',
      'second prune-lockfile should be a cache hit',
    );
    ok(sh('bun', ['add', 'zod@3.24.1']), 'bun add zod');
    assert(
      cacheStatus(t) === 'miss',
      'a version bump of a used package must invalidate prune-lockfile',
    );
    assert(
      pruned() === '3.24.1',
      `pruned package.json has zod ${pruned()}, expected 3.24.1`,
    );
    assert(
      cacheStatus(t) === 'hit',
      'prune-lockfile should hit again after the rebuild',
    );
  },
);

await step('watch mode restarts on change', async () => {
  const child = spawn(
    'bunx',
    ['nx', 'run', 'api:bun-serve', '--output-style=stream'],
    {
      cwd: ws,
      env,
      shell: isWin,
      detached: !isWin,
    },
  );
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  const waitFor = async (needle, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (out.includes(needle)) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`timeout waiting for "${needle}"\n${out.slice(-800)}`);
  };
  try {
    await waitFor('Hello world from api', 60000);
    const file = join(ws, 'apps/api/src/main.ts');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('Hello ', 'Changed '),
    );
    await waitFor('Changed world from api', 30000);
  } finally {
    if (isWin)
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
  }
});

await step('nx release version (dry run)', () => {
  const nxJson = json('nx.json');
  nxJson.release = {
    projects: ['@e2e/ui'],
    version: { conventionalCommits: false },
  };
  writeFileSync(join(ws, 'nx.json'), JSON.stringify(nxJson, null, 2));
  const g = (...a) =>
    sh('git', [
      '-c',
      'user.email=e2e@example.com',
      '-c',
      'user.name=e2e',
      ...a,
    ]);
  ok(sh('git', ['init', '-q']), 'git init');
  ok(g('add', '-A'), 'git add');
  ok(g('commit', '-qm', 'init'), 'git commit');
  // nx release does not accept --output-style
  const out = ok(
    sh('bunx', ['nx', 'release', 'version', '0.2.0', '--dry-run']),
    'release version',
  );
  assert(/0\.2\.0/.test(out), 'release did not report the new version');
});

const failed = results.filter(r => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} steps passed`,
);
if (!keep) rmSync(ws, { recursive: true, force: true });
else console.log(`kept ${ws}`);
process.exit(failed.length ? 1 : 0);
