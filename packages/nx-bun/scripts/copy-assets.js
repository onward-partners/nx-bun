// Copies everything tsc does not emit: json manifests, schemas, generator
// templates, README and LICENSE (from the repository root).
const {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} = require('fs');
const { join, relative } = require('path');

const root = join(__dirname, '..');
const repoRoot = join(root, '..', '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

for (const f of ['executors.json', 'generators.json']) {
  cpSync(join(root, f), join(dist, f));
}
for (const f of ['README.md', 'LICENSE']) {
  const from = existsSync(join(root, f)) ? join(root, f) : join(repoRoot, f);
  cpSync(from, join(dist, f));
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.json$/.test(name) || /__tmpl__$/.test(name)) {
      const target = join(dist, 'src', relative(join(root, 'src'), p));
      mkdirSync(join(target, '..'), { recursive: true });
      cpSync(p, target);
    }
  }
}
walk(join(root, 'src'));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
delete pkg.scripts;
delete pkg.devDependencies;
writeFileSync(join(dist, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
