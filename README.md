# R^ (Rhat) Language Support

**English** | [日本語](README.ja.md)

A VS Code extension for R^ (`rhat`). It provides syntax highlighting and language
configuration for `.rh` files and starts the native language server (`rhat lsp`)
over stdio. It is based on the L^ VS Code extension and adapted to R^ syntax and
its server.

## Features

- Language recognition, syntax highlighting, comment commands, and automatic closing of brackets and quotes for `.rh` files.
- Snippets for `def^`, `f^`, `p^`, `if^`, loops, `import^`, and more.
- Diagnostics, hover, completion, go to definition, references, signature help, Outline, and semantic tokens through `rhat lsp`.
- Notifications for unsaved edits and changes to dependent `.rh` files.
- Commands to restart or stop the server and show its output. The extension reconnects when settings or workspace folders change.

UI localization, a visual editor, LTON, and the L^ VM debug adapter are not
included. Analysis coverage and limitations follow `rhat lsp`: currently, open
documents and their import dependencies are analyzed. The extension does not
implement rename or formatting separately.

## Installation and configuration

Use VS Code **1.91 or later**. The standard VSIX produced by this project does
not bundle the native server. Build or install `rhat` from the R^ project and
configure its executable. The language server runs as `rhat lsp`; there is no
separate server executable.

The R^ build also copies `rhat` to `.rhat-ls/`, so you can build while the
language server is running. Point `rhat.serverPath` to that copy:

```json
{
  "rhat.serverPath": "C:/Users/Owner/source/repos/rhat/.rhat-ls/rhat.exe"
}
```

When `rhat.serverPath` is empty, the extension searches for `bin/rhat(.exe)`
inside the extension, then on PATH. In the F5 Extension Development Host, it
also searches the neighboring `../rhat/.rhat-ls`, then `../rhat/build/Debug`,
`Release`, and the single-configuration `build` directory, before PATH. A normal
installation does not automatically search a neighboring source repository.
Specify only the executable, without arguments such as `lsp` or `--stdio`.

Additional configuration example:

```json
{
  "rhat.serverPath": "${workspaceFolder}/tools/rhat.exe",
  "rhat.modulePaths": ["modules", "${workspaceFolder:shared}/lib"],
  "rhat.stdlibPath": "C:/tools/rhat/share/rhat/stdlib",
  "rhat.serverAutoRestart": false
}
```

| Setting | Description |
| --- | --- |
| `rhat.serverPath` | Executable path or command on PATH. Leave empty for automatic discovery. |
| `rhat.stdlibPath` | Standard library root containing files such as `std/random.rh`. Leave empty to let the server find it. |
| `rhat.modulePaths` | Additional search directories for user modules. |
| `rhat.serverAutoRestart` | Restart the server after an unexpected exit. Defaults to `true`. |

Paths support `${workspaceFolder}`, `${workspaceFolder:name}`, `${env:NAME}`,
and `~/`. Relative paths are resolved against the first workspace folder, or
against the file's directory when a file is opened without a folder. Settings
apply per window, and one server handles all workspace folders. For remote
connections, specify a server and paths on the extension host.

In Restricted Mode, syntax highlighting remains available. The native server
starts after the workspace is trusted.

## Commands

- **R^: Restart Language Server** — reload settings and reconnect.
- **R^: Stop Language Server** — stop the server so its executable can be rebuilt.
- **R^: Show Language Server Output** — show startup messages, errors, and server logs.

When using the `.rhat-ls` copy, you do not need to stop the server before a
build. Restart it afterward to use the new copy. If the copy is in use and
cannot be updated, the build emits a warning but does not fail. The Stop command
does not stop servers started by VS Code itself or another editor.

## Development

Building requires **Node.js 22 or later** and npm.

```powershell
npm ci
npm test
npm run test:server
```

`npm test` checks types, builds the bundle, and tests TextMate tokenization, path
resolution, and the VS Code API boundary. `npm run test:server` tests the
connection using the neighboring `rhat lsp`. You can specify another server:

```powershell
npm run test:server -- --server ../rhat/build/Release/rhat.exe
```

The connection test requires a build of the compiler. It creates a temporary
workspace and tests unsaved documents, dependent modules, diagnostics, UTF-16
coordinates, and shutdown over JSON-RPC. It does not drive the VS Code GUI.

### Debug / Release

```powershell
npm run build:debug
npm run build:release
```

Debug includes source maps. Release minifies JavaScript and does not generate
source maps for distribution. Both produce `dist/extension.js`. You can also
select either build from VS Code's **Run Build Task**.

Open this folder in VS Code and press **F5** to build with the selected Debug or
Release configuration and launch an Extension Development Host with
`testing/workspace` open. Open `main.rh` to try syntax highlighting, diagnostics,
go to definition, and more. `npm run watch` continuously updates the Debug
bundle; run `npm run check` for type checking.

The extension and `rhat` build configurations are independent. To use a Release
server, set `rhat.serverPath` to the absolute path of
`../rhat/build/Release/rhat.exe` or to an installed Release build. Build R^ with
`cmake --build build --config Release` or
`./scripts/build.ps1 -Configuration Release`.

## Building a VSIX

```powershell
npm run package
```

Packaging automatically runs a Release build and produces `rhat.vsix`. Select it
using VS Code's **Extensions: Install from VSIX...** command, or install it
from the command line:

```powershell
code --install-extension ./rhat.vsix --force
```

The build bundles `vscode-languageclient` and its runtime dependencies into
JavaScript, so npm is not required to use the VSIX. Licensing information is in
`LICENSE`, attribution for the original work is in `NOTICE`, and bundled
dependency notices are in `THIRD_PARTY_NOTICES.md`.

The extension does not register an R^-specific DAP. Future source debugging
will combine compiler debug information with an existing native debug adapter.
