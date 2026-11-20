import {
  type GeneratorCallback,
  type Tree,
  addDependenciesToPackageJson,
  formatFiles,
  readNxJson,
  updateNxJson,
} from '@nx/devkit';
import { typesBunVersion } from '../../utils/versions';

export interface InitGeneratorSchema {
  skipFormat?: boolean;
  skipPackageJson?: boolean;
  /** Also set `cli.packageManager` to bun in nx.json. */
  setPackageManager?: boolean;
}

export const PLUGIN_NAME = '@onward-partners/nx-bun';

/** Registers the plugin in nx.json and adds Bun's type definitions. */
export async function initGenerator(
  tree: Tree,
  options: InitGeneratorSchema = {},
): Promise<GeneratorCallback> {
  const nxJson = readNxJson(tree) ?? {};
  const plugins = nxJson.plugins ?? [];
  const registered = plugins.some(p =>
    typeof p === 'string' ? p === PLUGIN_NAME : p.plugin === PLUGIN_NAME,
  );
  if (!registered) plugins.push({ plugin: PLUGIN_NAME });
  nxJson.plugins = plugins;

  if (options.setPackageManager) {
    nxJson.cli = { ...nxJson.cli, packageManager: 'bun' };
  }
  updateNxJson(tree, nxJson);

  let installTask: GeneratorCallback = () => {};
  if (!options.skipPackageJson) {
    installTask = addDependenciesToPackageJson(
      tree,
      {},
      { '@types/bun': typesBunVersion },
    );
  }

  if (!options.skipFormat) await formatFiles(tree);
  return installTask;
}

export default initGenerator;
