import type { ProjectGraph } from '@nx/devkit';

/**
 * Collect every npm package a project needs, following workspace library
 * dependencies, with the exact versions Nx read from the lockfile.
 *
 * Returns `{ name: version }`, sorted by name.
 */
export function collectNpmDependencies(
  graph: ProjectGraph,
  projectName: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  const queue = [projectName];

  while (queue.length) {
    const current = queue.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dep of graph.dependencies[current] ?? []) {
      if (dep.target.startsWith('npm:')) {
        const node = graph.externalNodes?.[dep.target];
        const name = node?.data.packageName ?? dep.target.slice(4);
        const version = node?.data.version;
        if (version && !(name in result)) result[name] = version;
      } else if (graph.nodes[dep.target]) {
        queue.push(dep.target);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Keep the dependencies selected by an `external` list; `all` keeps everything. */
export function filterDependencies(
  deps: Record<string, string>,
  mode: 'all' | string[],
): Record<string, string> {
  if (mode === 'all') return deps;
  return Object.fromEntries(
    Object.entries(deps).filter(([name]) =>
      mode.some(e => name === e || name.startsWith(`${e}/`)),
    ),
  );
}
