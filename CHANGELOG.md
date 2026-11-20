# Changelog

All notable changes to `@onward-partners/nx-bun` are documented here.

## [Unreleased]

## [0.0.5] - 2026-11-20

### Added

- `check` executor: type checks a project with `bun check`. Options: `files`,
  `project`, `build`, `pretty`, `all`, `threads`, `timing`.
- Inferred `bun-check` target for projects with a `tsconfig.json`; rename or
  disable it with the `checkTargetName` plugin option.

### Changed

- Releases are also published to npm, using trusted publishing (OIDC) with
  provenance. GitHub Packages keeps receiving every release.
- `publishConfig` no longer pins GitHub Packages; the release workflow picks
  the registry.

## [0.0.2] - 2026-11-20

### Added

- `release-publish` executor: runs `bun publish` for `nx release`. The inferred
  `nx-release-publish` target now uses it, because `@nx/js:release-publish`
  passes `--json`, which Bun rejects. Options: `packageRoot`, `registry`,
  `tag`, `access`, `otp`, `dryRun`, `tolerateRepublish` (default `true`).
- `build` executor: `plugins` (module paths with Bun plugins; runs the build
  through `Bun.build()`) and `clean` (empty the output before building).
- Plugin options to control inferred targets: every `*TargetName` accepts
  `false`, plus `include` / `exclude` globs on project roots and `rootProject`.
- `run` executor: `outputPath`, used as cache `outputs` for script targets.
- `init` generator adds `targetDefaults` for `@onward-partners/nx-bun:run`
  (Bun version and `NODE_ENV` as inputs, `{options.outputPath}` as outputs).
- GitHub Packages publishing setup.

### Changed

- A `bunfig.toml` in the workspace root no longer creates a root project. Set
  `rootProject: true` to keep the old behavior.
- `bun-start`, `bun-prune-lockfile` and the `nx-release-publish` build
  dependency are skipped when the build target is disabled.

### Fixed

- Expand Windows 8.3 short paths before spawning, so `import.meta.main` works
  when the working directory is a short path.

## [0.0.1]

- Initial release: generators, inferred targets and executors for `bun run`,
  `bun build`, `bun test` and `bun fmt`, plus `prune-lockfile`.
