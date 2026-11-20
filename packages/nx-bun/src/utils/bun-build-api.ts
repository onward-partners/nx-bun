/**
 * `bun build` (CLI) has no plugin support, so builds with plugins run this
 * script through `bun -e`, which calls `Bun.build()`. The options come from
 * the `NX_BUN_BUILD_CONFIG` environment variable (JSON), which avoids any
 * shell quoting.
 */
export const BUILD_CONFIG_ENV = 'NX_BUN_BUILD_CONFIG';

export interface BunBuildApiConfig {
  /** Absolute module paths exporting a BunPlugin, an array of them, or a function returning either. */
  plugins: string[];
  config: Record<string, unknown>;
}

export const BUILD_SCRIPT = `
import { pathToFileURL } from 'node:url';
const { plugins: modules, config } = JSON.parse(process.env.${BUILD_CONFIG_ENV});
const plugins = [];
for (const file of modules) {
  const mod = await import(pathToFileURL(file).href);
  let exported = mod.default ?? mod.plugins ?? mod.plugin;
  if (typeof exported === 'function') exported = await exported();
  if (!exported) throw new Error('Plugin module ' + file + ' has no default, "plugins" or "plugin" export.');
  plugins.push(...[].concat(exported));
}
const result = await Bun.build({ ...config, plugins });
for (const log of result.logs) console[log.level === 'error' ? 'error' : 'log'](String(log));
if (!result.success) process.exit(1);
for (const out of result.outputs) console.log(out.path);
`;

/** Translate `KEY=VALUE` strings (the CLI `--define` form) to an object. */
export function defineToObject(define: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of define) {
    const i = item.indexOf('=');
    if (i < 1) throw new Error(`Invalid define "${item}", expected KEY=VALUE.`);
    out[item.slice(0, i)] = item.slice(i + 1);
  }
  return out;
}
