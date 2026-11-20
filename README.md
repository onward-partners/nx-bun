# @onward-partners/nx-bun

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-339933.svg?style=flat-square)](<>)
[![Bun](https://img.shields.io/badge/bun-%E2%89%A51.4-f9a03c.svg?style=flat-square)](<>)

</div>

Nx plugin that treats [Bun](https://bun.sh) as a first-class toolchain for JS/TS apps and libraries: generators, inferred targets, and executors for `bun run`, `bun build`, `bun test` and `bun fmt`, plus a Bun-aware `prune-lockfile`.

- Requires **Nx 24.x**, **Node 24+** and **Bun 1.4+**.
- Nx itself keeps running on Node; the plugin runs your projects with Bun.
- Tested on Windows and Linux. macOS is covered by the CI matrix.

## Getting started

The package is published on [npm](https://www.npmjs.com/package/@onward-partners/nx-bun) and mirrored to GitHub Packages. Projects whose `@onward-partners` scope points at GitHub Packages (see [Installing from GitHub Packages](#installing-from-github-packages)) get it from there.

```shell
bun add -D @onward-partners/nx-bun
nx g @onward-partners/nx-bun:init
nx g @onward-partners/nx-bun:application apps/api
nx g @onward-partners/nx-bun:library libs/util --importPath=@acme/util

nx run api:bun-test
nx run api:bun-serve      # run the TypeScript source with bun --watch
nx run api:bun-start      # build, then run the compiled output
```

## Generators

| Generator                   | Purpose                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `init`                      | Registers the plugin in `nx.json`, adds `@types/bun`. `--setPackageManager` sets `cli.packageManager: bun`.                   |
| `application` (`app`)       | `apps/<name>` with `package.json`, `bunfig.toml`, `tsconfig.json`, `src/main.ts` and a `bun:test` spec.                       |
| `library` (`lib`)           | `libs/<name>`, source-linked via a `tsconfig.base.json` path. `--publishable` makes `package.json` point at the build output. |
| `project` (`configuration`) | Adds `bunfig.toml` to an existing project so the targets below are inferred.                                                  |

## Inferred targets

A project is a Bun project when `bunfig.toml` sits next to a `package.json` or `project.json`. A `bunfig.toml` in the workspace root is ignored (it usually only holds install settings such as the registry scope); set `rootProject: true` if the root really is a Bun project.

| Target                     | Created when                                   | What it does                                                                                  |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `bun-test`                 | test files exist                               | `bun test`                                                                                    |
| `bun-fmt`, `bun-fmt-check` | always                                         | `bun fmt`, `bun fmt --check`                                                                  |
| `bun-build`                | entry found (`src/index.ts`, `src/main.ts`, …) | `bun build`; publishable projects also get `dts`, `generatePackageJson`, `packages: external` |
| `bun-serve`                | entry found                                    | runs the **source** with `bun --watch` (continuous)                                           |
| `bun-start`                | entry found                                    | builds, then runs the **compiled output**                                                     |
| `bun-prune-lockfile`       | private project with entry                     | `package.json` + `bun.lock` with only the needed packages                                     |
| `nx-release-publish`       | non-private project with entry                 | `bun publish` on `dist/<root>` via this plugin's `release-publish` executor                   |

Plugin options:

| Option                                                                                                                                   | Effect                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `buildTargetName`, `testTargetName`, `serveTargetName`, `startTargetName`, `fmtTargetName`, `fmtCheckTargetName`, `pruneLockfileTargetName` | Rename a target, or set it to `false` to not infer it (for example `fmtTargetName: false` if you use Prettier). |
| `releasePublish: false`                                                                                                                  | Do not infer `nx-release-publish`.                                                                        |
| `include`, `exclude`                                                                                                                     | Globs (`*`, `**`, `?`) on project roots. Only matching projects (`include`) / never matching ones (`exclude`) get targets. |
| `rootProject`                                                                                                                            | Also infer targets for a `bunfig.toml` in the workspace root. Default `false`.                            |

`bun-start` and `bun-prune-lockfile` need the build target, so they are skipped when `buildTargetName` is `false`. A project that already defines its own `build` can set `buildTargetName: false` (and the other names) or be listed in `exclude`.

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@onward-partners/nx-bun",
      "options": { "buildTargetName": "build" },
    },
  ],
}
```

## Executors

- **`run`** – `main` runs TypeScript/JavaScript source directly; `buildTarget` runs the compiled output of a build target (`runtime: bun | node`; `--compile` binaries start directly). Also `watch`, `hot`, `args`, `env`.
- **`build`** – `entryPoints`, `outputPath` / `outfile` (`outfile` wins), `target`, `format`, `minify`, `sourcemap`, `splitting`, `compile`, `packages`, `external`, `define`, `dts`, `generatePackageJson`, `assets`, `clean` (empty the output first) and `plugins` (see below).
- **`test`** – `testFiles`, `timeout`, `bail`, `coverage`, `coverageReporter`, `updateSnapshots`, `watch`, `testNamePattern`, `reporter`, `passWithNoTests`, `concurrent`, `randomize`, `only`.
- **`fmt`** – `files`, `check`, `printWidth`, `useTabs`, `noSemi`, `singleQuote`, `changed`.
- **`release-publish`** – `bun publish` for `nx release`. `@nx/js:release-publish` passes `--json`, which Bun rejects, so the inferred `nx-release-publish` target uses this executor. Options: `packageRoot`, `registry`, `tag`, `access`, `otp`, `dryRun`, `tolerateRepublish` (default `true`). Bun asks for credentials even with `dryRun`.
- **`prune-lockfile`** – Bun replacement for `@nx/js:prune-lockfile`, which does not support Bun. Pins dependencies to the versions Nx read from the workspace `bun.lock`, then runs `bun install --lockfile-only`. Useful for Docker builds.

### Bun plugins

`bun build` has no plugin flag, so `plugins` runs the build through `Bun.build()`. List module paths whose default export is a `BunPlugin`, an array of them, or a function returning either (raw `args` are not supported in this mode):

```jsonc
"build": {
  "executor": "@onward-partners/nx-bun:build",
  "options": { "entryPoints": ["apps/cli/src/main.ts"], "outputPath": "dist/apps/cli", "clean": true, "plugins": ["apps/cli/stub-plugin.ts"] }
}
```

### Caching script targets

A `run` target with `main` (a build script) has no inferred cache config. `nx g @onward-partners/nx-bun:init` adds a `targetDefaults` entry for `@onward-partners/nx-bun:run` with the Bun version and `NODE_ENV` as inputs and `{options.outputPath}` as outputs. Set `cache: true` and `outputPath` on the target:

```jsonc
"build-script": {
  "executor": "@onward-partners/nx-bun:run",
  "cache": true,
  "options": { "main": "apps/cli/build.ts", "outputPath": "dist/apps/cli" }
}
```

Every executor accepts `env` and `args` (raw flags). Set `BUN_BIN` to use a specific Bun binary.

## Development

```shell
bun install
bun run typecheck
bun run build      # compiles packages/nx-bun into packages/nx-bun/dist
bun run test       # unit tests (bun test)
bun run e2e        # fresh Nx workspace with the built plugin and real bun
```

The repository is a Bun workspace; the plugin lives in [`packages/nx-bun`](packages/nx-bun).

## Publishing

Every release goes to [npm](https://www.npmjs.com/package/@onward-partners/nx-bun) and to [GitHub Packages](https://github.com/orgs/onward-partners/packages). The publishable package is the build output (`packages/nx-bun/dist`), not the source folder.

**Release (recommended):** bump `version` in `packages/nx-bun/package.json`, commit, then push a matching tag. The `Release` workflow checks the tag against the version, runs typecheck, build, tests and e2e, then publishes to both registries:

- **npm** via [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no token, with provenance).
- **GitHub Packages** with the built-in `GITHUB_TOKEN`.

```shell
git tag v0.1.0
git push origin v0.1.0
```

**One-time npm setup:**

1. Create the `onward-partners` organization on npmjs.com.
2. Publish the first version manually (trusted publishing can only be configured for an existing package): `bun run prepublish:check && bun run build`, then `cd packages/nx-bun/dist && npm login && npm publish --access public`.
3. On npmjs.com open the package → *Settings* → *Trusted Publisher* → GitHub Actions: organization `onward-partners`, repository `nx-bun`, workflow `release.yml`. Optionally set the package to *Require two-factor authentication and disallow tokens*.

`bun run pack` writes a tarball to `tmp/` so you can inspect the contents first.

### Installing from GitHub Packages

Only needed if you want the GitHub Packages copy instead of npm. GitHub Packages needs authentication even for reading; use a token with `read:packages`.

With Bun, add the scope to `bunfig.toml` (the token is read from the environment):

```toml
[install.scopes]
"@onward-partners" = { url = "https://npm.pkg.github.com", token = "$GITHUB_TOKEN" }
```

With npm, pnpm or yarn, use an `.npmrc`:

```ini
@onward-partners:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Never commit a literal token.

## License

[MIT](LICENSE)
