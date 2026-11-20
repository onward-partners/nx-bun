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

  // Script targets (`run` with `main`) are not inferred, so they would have no
  // cache inputs or outputs. `targetDefaults` keyed by executor applies to every
  // such target; caching itself stays opt-in (`cache: true`) per target.
  const targetDefaults = (nxJson.targetDefaults ??= {});
  targetDefaults[`${PLUGIN_NAME}:run`] ??= {
    inputs: [
      'default',
      '^default',
      { runtime: 'bun --version' },
      { env: 'NODE_ENV' },
    ],
    outputs: ['{options.outputPath}'],
  };

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
