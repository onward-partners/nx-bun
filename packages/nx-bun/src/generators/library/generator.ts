import {
  type GeneratorCallback,
  type Tree,
  addProjectConfiguration,
  formatFiles,
  generateFiles,
  joinPathFragments,
  names,
  offsetFromRoot,
  runTasksInSerial,
  updateJson,
} from '@nx/devkit';
import { determineProjectNameAndRootOptions } from '@nx/devkit/internal';
import { join } from 'node:path';
import { parseTags } from '../application/generator';
import { initGenerator } from '../init/generator';

export interface LibraryGeneratorSchema {
  name: string;
  directory?: string;
  importPath?: string;
  tags?: string;
  /** Library is published to a registry and built with bun build. */
  publishable?: boolean;
  unitTestRunner?: 'bun' | 'none';
  useProjectJson?: boolean;
  skipFormat?: boolean;
  skipPackageJson?: boolean;
}

export async function libraryGenerator(
  tree: Tree,
  options: LibraryGeneratorSchema,
): Promise<GeneratorCallback> {
  if (options.publishable && !options.importPath) {
    throw new Error(
      'A publishable library needs an `importPath`, e.g. @scope/my-lib.',
    );
  }
  const initTask = await initGenerator(tree, {
    skipFormat: true,
    skipPackageJson: options.skipPackageJson,
  });

  const {
    projectName,
    projectRoot,
    names: n,
    importPath,
  } = await determineProjectNameAndRootOptions(tree, {
    name: options.name,
    projectType: 'library',
    directory: options.directory ?? `libs/${options.name}`,
    importPath: options.importPath,
  });

  const withTests = (options.unitTestRunner ?? 'bun') === 'bun';
  generateFiles(tree, join(__dirname, 'files'), projectRoot, {
    projectName,
    importPath,
    fileName: n.projectFileName,
    propertyName: names(n.projectSimpleName).propertyName,
    offsetFromRoot: offsetFromRoot(projectRoot),
    publishable: !!options.publishable,
    tmpl: '',
  });
  const libFile = n.projectFileName.replace(/^.*\//, '');
  // template names are fixed (lib.ts); rename to the project name
  const libDir = joinPathFragments(projectRoot, 'src/lib');
  tree.rename(`${libDir}/lib.ts`, `${libDir}/${libFile}.ts`);
  if (withTests) {
    tree.rename(`${libDir}/lib.test.ts`, `${libDir}/${libFile}.test.ts`);
  } else {
    tree.delete(`${libDir}/lib.test.ts`);
  }
  tree.write(
    joinPathFragments(projectRoot, 'src/index.ts'),
    `export * from './lib/${libFile}';\n`,
  );

  // Source-linked consumption through the tsconfig path alias.
  if (tree.exists('tsconfig.base.json')) {
    updateJson(tree, 'tsconfig.base.json', json => {
      json.compilerOptions ??= {};
      json.compilerOptions.paths ??= {};
      if (json.compilerOptions.paths[importPath]) {
        throw new Error(
          `The import path ${importPath} is already used in tsconfig.base.json.`,
        );
      }
      // Without baseUrl, TypeScript only accepts relative path mappings.
      const entry = joinPathFragments(projectRoot, 'src/index.ts');
      json.compilerOptions.paths[importPath] = [
        json.compilerOptions.baseUrl ? entry : `./${entry}`,
      ];
      return json;
    });
  }

  if (options.useProjectJson) {
    addProjectConfiguration(tree, projectName, {
      root: projectRoot,
      projectType: 'library',
      sourceRoot: joinPathFragments(projectRoot, 'src'),
      tags: parseTags(options.tags),
      targets: {},
    });
  } else if (options.tags) {
    updateJson(tree, joinPathFragments(projectRoot, 'package.json'), pkg => {
      pkg.nx = { ...pkg.nx, tags: parseTags(options.tags) };
      return pkg;
    });
  }

  if (!options.skipFormat) await formatFiles(tree);
  return runTasksInSerial(initTask);
}

export default libraryGenerator;
