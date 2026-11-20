import {
  type GeneratorCallback,
  type Tree,
  formatFiles,
  generateFiles,
  joinPathFragments,
  names,
  offsetFromRoot,
  runTasksInSerial,
  addProjectConfiguration,
} from '@nx/devkit';
import { determineProjectNameAndRootOptions } from '@nx/devkit/internal';
import { join } from 'node:path';
import { initGenerator } from '../init/generator';

export interface ApplicationGeneratorSchema {
  name: string;
  directory?: string;
  tags?: string;
  unitTestRunner?: 'bun' | 'none';
  /** Write a project.json with explicit targets instead of relying on inference. */
  useProjectJson?: boolean;
  skipFormat?: boolean;
  skipPackageJson?: boolean;
}

export async function applicationGenerator(
  tree: Tree,
  options: ApplicationGeneratorSchema,
): Promise<GeneratorCallback> {
  const initTask = await initGenerator(tree, {
    skipFormat: true,
    skipPackageJson: options.skipPackageJson,
  });

  const {
    projectName,
    projectRoot,
    names: n,
  } = await determineProjectNameAndRootOptions(tree, {
    name: options.name,
    projectType: 'application',
    directory: options.directory ?? `apps/${options.name}`,
  });

  const withTests = (options.unitTestRunner ?? 'bun') === 'bun';
  generateFiles(tree, join(__dirname, 'files'), projectRoot, {
    projectName,
    projectFileName: n.projectFileName,
    offsetFromRoot: offsetFromRoot(projectRoot),
    className: names(n.projectSimpleName).className,
    tmpl: '',
  });
  if (!withTests)
    tree.delete(joinPathFragments(projectRoot, 'src/main.test.ts'));

  // package.json (name/version) is created from the template; project.json is
  // optional because the plugin infers every target from bunfig.toml.
  if (options.useProjectJson) {
    addProjectConfiguration(tree, projectName, {
      root: projectRoot,
      projectType: 'application',
      sourceRoot: joinPathFragments(projectRoot, 'src'),
      tags: parseTags(options.tags),
      targets: {},
    });
  } else if (options.tags) {
    const pkgPath = joinPathFragments(projectRoot, 'package.json');
    const pkg = JSON.parse(tree.read(pkgPath, 'utf-8') as string);
    pkg.nx = { ...pkg.nx, tags: parseTags(options.tags) };
    tree.write(pkgPath, JSON.stringify(pkg, null, 2));
  }

  if (!options.skipFormat) await formatFiles(tree);
  return runTasksInSerial(initTask);
}

export function parseTags(tags?: string): string[] {
  return tags
    ? tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
    : [];
}

export default applicationGenerator;
