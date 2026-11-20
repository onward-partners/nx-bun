import {
  type GeneratorCallback,
  type Tree,
  formatFiles,
  joinPathFragments,
  readProjectConfiguration,
  runTasksInSerial,
} from '@nx/devkit';
import { initGenerator } from '../init/generator';

export interface ProjectGeneratorSchema {
  project: string;
  skipFormat?: boolean;
  skipPackageJson?: boolean;
}

const BUNFIG = '[test]\n# coverage = false\n';

/**
 * Turn an existing project into a Bun project by adding a bunfig.toml.
 * The plugin then infers the bun-* targets for it.
 */
export async function projectGenerator(
  tree: Tree,
  options: ProjectGeneratorSchema,
): Promise<GeneratorCallback> {
  const config = readProjectConfiguration(tree, options.project);
  const initTask = await initGenerator(tree, {
    skipFormat: true,
    skipPackageJson: options.skipPackageJson,
  });

  const bunfig = joinPathFragments(config.root, 'bunfig.toml');
  if (!tree.exists(bunfig)) tree.write(bunfig, BUNFIG);

  if (
    !tree.exists(joinPathFragments(config.root, 'package.json')) &&
    !tree.exists(joinPathFragments(config.root, 'project.json'))
  ) {
    throw new Error(
      `Project ${options.project} has neither package.json nor project.json in ${config.root}.`,
    );
  }

  if (!options.skipFormat) await formatFiles(tree);
  return runTasksInSerial(initTask);
}

export default projectGenerator;
