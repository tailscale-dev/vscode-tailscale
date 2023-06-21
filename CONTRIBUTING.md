# Tailscale VS Code Extension

## Running the extension

Inside the editor, press F5. This will compile and run the extension in a new Extension Development Host window.
Alternatively, from "Debug & Run" in the "Activity Bar", click the play icon for "Start Debugging"

## Building the extension

A vsix build can be produced by running `./tool/yarn vsce package --allow-star-activation`

## Development tools

Following the [Tailscale OSS](https://github.com/tailscale/tailscale) repository, we use a `./tool` directory to manage tool dependencies. Versions are pinned via `*.rev` files in the projects' root and installed via `./tool/redo.sh` using the `*.cmd.do` files also in the project's root.

Flakes are provided for Nix users, with `nix develop` for the environment.

The following tools are available:

- `./tool/node` - [Node](https://nodejs.org/) for future JavaScript tooling
- `./tool/yarn` - [Yarn](https://yarnpkg.com/) package manager
- `./tool/redo.sh` - [Redo](https://github.com/apenwarr/redo) build/automation tool (for deps)

If available, [direnv](https://direnv.net/) will place these tools in your PATH per our `.envrc` config. Installation instructions for direnv are available [here](https://direnv.net/docs/installation.html).

## Webview

### Icons

Our VS Code extension uses the VS Code Codicons icon font provided by Microsoft, which can be accessed through the following GitHub repository: [microsoft/vscode-codicons](https://github.com/microsoft/vscode-codicons). The icon font is generated using the Fantasticon tool and includes a wide range of icons suitable for different purposes.

To search for specific icons, you can use the icon search tool available at https://microsoft.github.io/vscode-codicons/dist/codicon.html. Once you have found the desired icon, you can include it in your HTML code using the following syntax:

```html
<div className="codicon codicon-add"></div>
```

Alternatively, you can use an SVG sprite to include the icon in your code, as shown below:

```html
<svg>
  <use xlink:href="codicon.svg#add" />
</svg>
```

Note that the `codicon-add` class in the first example corresponds to the `add` icon in the second example, which is referenced by the `#add` attribute in the SVG `<use>` element.

### Colors

To ensure that our VS Code extension is compatible with different themes, we recommend using CSS variables provided by VS Code whenever possible. These variables are defined by the VS Code theme and can be accessed by our extension to ensure consistent styling across different themes.

To discover the available CSS variables, you can access the Developer Tools (more information is available in the [debugging](#debugging-webviews) section) or use the Spectrum plugin, which provides a visual editor for modifying VS Code themes. The Spectrum plugin is available from the VS Code Marketplace at https://marketplace.visualstudio.com/items?itemName=GitHubOCTO.spectrum.

To use a CSS variable in your code, you can include it in a CSS property value using the `var()` function, as shown below:

```css
text-[var(--vscode-button-background)]
```

In this example, the `--vscode-button-background` variable is used to set the background color of a text element, but you can use other variables for different properties and purposes. Using CSS variables in this way ensures that your extension will be compatible with different themes and will adapt to the user's preferences.

### Debugging webviews

To debug webviews in our VS Code extension, you can access the Developer Tools by selecting "Developer: Toggle Developer Tools" from the Command Palette. The Command Palette can be opened by clicking on the icon in the top-right corner of the VS Code window or by using the keyboard shortcut <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Windows or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Mac. Once the Developer Tools are open, you can inspect and debug the webviews using the same tools available for debugging web pages in a web browser.

### VS Code Webview UI Toolkit

We make use of [Webview UI Toolkit for Visual Studio Code](https://www.npmjs.com/package/@vscode/webview-ui-toolkit), specifically for its [React Components](https://github.com/microsoft/vscode-webview-ui-toolkit/tree/main/src/react)](https://github.com/microsoft/vscode-webview-ui-toolkit/tree/main/src/react) which are wrappers around the components. These components follow the design language of VS Code to maintain a consistent look and feel.

### Backporting

To backport a PR, add the `auto-backport` label to a PR and a corresponding version label (example: `v0.4`). Once the PR is merged, a corresponding backport PR will be created against the release branch.

## Release Process

#### To make a new minor release. (e.g., `0.2` ⇒ `0.4`)

From the `main` branch:

```
$ git checkout -b release-branch/0.4
```

#### To make a new patch for an existing release (e.g., `0.2.0` ⇒ `0.2.1`)

```
git checkout release-branch/0.2

# cherry-pick to add patches to the release
$ git cherry-pick -x <commit-id>
```

### Update CHANGELOG.md

Using the diff between the latest tag, and the release branch after cherry picking

```
git log --pretty=oneline v0.2.1..release-branch/v0.2
```

Group changes by `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`
Open a pull-request for the changes and cherry-pick into the release branch

### Update the version

```
$ npm version --no-git-tag-version 0.2.1
$ git add package.json && git commit -sm 'version: v0.2.1'
$ git tag -am "Relase 0.2.1" "v0.2.1"
```

### Create or update an existing release branch

### Push the release branch and tag

```
$ git push -u origin HEAD
$ git push origin v0.2.1
```

### Upload to marketplace

https://marketplace.visualstudio.com/manage
