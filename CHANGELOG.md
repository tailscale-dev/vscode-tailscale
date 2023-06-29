# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to an [Odd-Even Versioning](https://en.wikipedia.org/wiki/Software_versioning#Odd-numbered_versions_for_development_releases) scheme. Odd-numbered versions are used for development and pre-release updates, while even-numbered versions are used for stable or public releases.

## [0.4.4] - 2023-06-29

An update providing a fix for users running on Flatpak while reducing the required VS Code version to 1.74.0.

### Changed

- package.json: change "engines"."vscode" to "^1.74.0" (#89)
- Only run in the UI, not on a remote (#58)
- Replace tailscale binary with tailscaled unix socket (#83)
- Upgrade dependencies: vscode (#48), @types/node (#49), glob (#51), eslint (#65), webpack (#63), typescript (#69, #78), react (#68), @types/react (#74), swr (#72),

### Fixed

- Run flatpak-spawn when pkexec is needed (#86)
- Only add menu items to serve view (#77)

## [0.4.3] - 2023-06-21

### Fixed

- Use sudo-prompt to re-run tsrelay in Linux (#64)
- src/tailscale/cli: fix go path for development mode (#67)
- Return manual resolution when access is denied to LocalBackend (#60)
- Output server details as json (#37)

### Changed

- Upgrade dependencies: react, typescript, webpack, eslint, prettier, postcss, tailwindcss, lint-staged (#38, #39, #40, #41, #43, #44, #46, #47, #50, #53)

## [0.4.2] - 2023-06-13

### Added

- serve/simple: Notice for Linux users (#62)

## [0.4.1] - 2023-06-13

### Added

- Show error message for expired node key (#1)
- Provide information on service underlying a proxy (#2)
- readme: Added notice for Linux users (#61)

### Changed

- portdisco: switch to upstream portlist package (#10)
- Upgrade dependencies: webpack, webpack-cli, webpack-dev-server, css-loader, postcss-loader, style-loader, ts-loader (#34)

Initial public release

## [0.4.0] - 2023-05-31

### Added

- Simple view for adding a Funnel
