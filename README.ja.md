# R^ (Rhat) Language Support

[English](README.md) | **日本語**

R^ (`rhat`) 用の VS Code 拡張です。`.rh` の構文強調と言語設定を提供し、
ネイティブ言語サーバー（`rhat lsp`）を stdio で起動します。
L^ の VS Code 拡張を参考に、R^ の構文とサーバーに合わせて構成しています。

## 機能

- `.rh` の言語認識、構文強調、コメント操作、括弧・引用符の補完。
- `def^`、`f^`、`p^`、`if^`、各種ループ、`import^` などのスニペット。
- `rhat lsp` による診断、ホバー、補完、定義移動、参照検索、シグネチャヘルプ、Outline、semantic tokens。
- `rhat format` と共通のエンジンによるドキュメント整形。設定は `.editorconfig`。
- 未保存の編集、依存する `.rh` ファイルの変更通知。
- サーバーの再起動・停止・ログ表示。設定やワークスペースフォルダーの変更時には再接続。

UI の多言語化、ビジュアルエディター、LTON、L^ の VM 用デバッグアダプターは含めません。
解析範囲と制限は `rhat lsp` に準じます。現在は開いた文書と import 依存が対象で、
rename は独自には実装していません。整形にはサーバーの標準 LSP 機能を使います。

**ドキュメントのフォーマット**（Windows では `Shift+Alt+F`）で現在のバッファを整形できます。
R^ の既定フォーマッターにはこの拡張を指定しています。保存時にも整形する場合の設定例です。

```json
"[rhat]": {
  "editor.defaultFormatter": "SAMtak.rhat",
  "editor.formatOnSave": true
}
```

インデント・改行・末尾改行・行の長さは EditorConfig で指定します。
R^ 固有の項目は `rhat_brace_style = same_line | next_line` と
`rhat_space_after_hat = false | true` です。構文が壊れている場合は編集を返さず、
コメント・文字列・字句の綴りを保ちます。対応する `rhat` への更新後は言語サーバーを再起動してください。

## インストールと設定

VS Code **1.91 以降**を使用してください。
このプロジェクトで生成する通常の VSIX には、ネイティブサーバーを同梱しません。
R^ 側で `rhat` をビルドまたはインストールし、その実行ファイルを設定します。言語サーバーは `rhat lsp` で、別の実行ファイルはありません。
R^ のビルドは `rhat` を `.rhat-ls/` にもコピーするので、言語サーバーの実行中でもビルドできます（`rhat.serverPath` には `.rhat-ls` 側を指定します）。

```json
{
  "rhat.serverPath": "C:/Users/Owner/source/repos/rhat/.rhat-ls/rhat.exe"
}
```

`rhat.serverPath` が空の場合は、拡張内の `bin/rhat(.exe)`、次に PATH を探索します。
F5 の Extension Development Host では、その間に隣の `../rhat/.rhat-ls`、次に `../rhat/build/Debug`、`Release`、
単一構成の `build` も探索します。通常インストールでは、隣のソースリポジトリを自動探索しません。
設定には実行ファイル名だけを渡し、`lsp` や `--stdio` などの引数を含めないでください。

追加の設定例です。

```json
{
  "rhat.serverPath": "${workspaceFolder}/tools/rhat.exe",
  "rhat.modulePaths": ["modules", "${workspaceFolder:shared}/lib"],
  "rhat.stdlibPath": "C:/tools/rhat/share/rhat/stdlib",
  "rhat.serverAutoRestart": false
}
```

| 設定 | 内容 |
| --- | --- |
| `rhat.serverPath` | 実行ファイルのパス、または PATH 上のコマンド名。空なら自動探索。 |
| `rhat.stdlibPath` | `std/random.rh` などが入った標準ライブラリのルート。空ならサーバーに任せる。 |
| `rhat.modulePaths` | ユーザーモジュールの追加探索ディレクトリ。 |
| `rhat.serverAutoRestart` | 異常終了後の自動再起動。既定は `true`。 |

パスでは `${workspaceFolder}`、`${workspaceFolder:name}`、`${env:NAME}`、`~/` を使用できます。
相対パスは最初のワークスペースフォルダーを基準にします。
フォルダーなしでファイルだけを開いた場合は、そのファイルのディレクトリを基準にします。
設定はウィンドウ単位で、一つのサーバーが全ワークスペースフォルダーを受け持ちます。
リモート接続では拡張ホスト側にあるサーバーとパスを指定してください。

Restricted Mode では構文強調を利用でき、ネイティブサーバーはワークスペースを信頼した後に起動します。

## コマンド

- **R^: Restart Language Server** — 設定を読み直して再接続。
- **R^: Stop Language Server** — サーバーを終了し、実行ファイルの再ビルドを可能にする。
- **R^: Show Language Server Output** — 起動・エラー・サーバーログを表示。

`.rhat-ls` のコピーを使っていれば、ビルド前に Stop を実行する必要はありません。ビルド後に Restart を実行すると、新しいコピーに切り替わります。
コピーが使用中で更新できなかったときは、ビルドが警告を出すだけで失敗はしません。
VS Code 自身や別のエディターが起動したサーバーは、この Stop コマンドの対象ではありません。

## 開発

ビルドには **Node.js 22 以降**と npm が必要です。

```powershell
npm ci
npm test
npm run test:server
```

`npm test` は型検査、バンドル生成、TextMate の実トークン化、パス解決、VS Code API 境界のテストを行います。
`npm run test:server` は隣の `rhat lsp` を使う接続テストです。別のサーバーも指定できます。

```powershell
npm run test:server -- --server ../rhat/build/Release/rhat.exe
```

接続テストにはコンパイラ側のビルドが必要です。
テストは一時ワークスペースを作り、JSON-RPC で未保存文書・依存モジュール・診断・UTF-16 座標・終了処理を検証します。
VS Code の GUI を操作するテストではありません。

### Debug / Release

```powershell
npm run build:debug
npm run build:release
```

Debug はソースマップ付き、Release は JavaScript を最小化し、配布用ソースマップを生成しません。
どちらも `dist/extension.js` を生成します。
VS Code の **Run Build Task** からも、それぞれのビルドを選択できます。

このフォルダーを VS Code で開いて **F5** を押すと、選択した Debug / Release 設定でビルドし、
`testing/workspace` を開いた Extension Development Host を起動します。
`main.rh` を開くと、構文強調・診断・定義移動などを試せます。
`npm run watch` は Debug バンドルを継続更新します。型検査は `npm run check` で行います。

拡張のビルド構成と `rhat` の構成は独立しています。
Release のサーバーを使う場合は、`rhat.serverPath` に `../rhat/build/Release/rhat.exe` の
絶対パス、またはインストールした Release 版を指定してください。
R^ 側のビルドは `cmake --build build --config Release`、または
`./scripts/build.ps1 -Configuration Release` で行えます。

## VSIX の生成

```powershell
npm run package
```

VSIX 作成時は自動的に Release ビルドを実行します。
生成物は `rhat.vsix` です。VS Code の **Extensions: Install from VSIX...** から選択できます。
コマンドでもインストールできます。

```powershell
code --install-extension ./rhat.vsix --force
```

ビルド時に `vscode-languageclient` と実行時依存を JavaScript にまとめるため、VSIX の利用時に npm は不要です。
ライセンスは `LICENSE`、移植元の表示は `NOTICE`、同梱依存の表示は `THIRD_PARTY_NOTICES.md` に保持します。
R^ 独自の DAP は登録しません。将来のソースデバッグには、コンパイラのデバッグ情報出力と
既存のネイティブ用デバッグアダプターを組み合わせます。
