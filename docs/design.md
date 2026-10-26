# 拡張の構成

`src/extension.ts` は VS Code API と `vscode-languageclient` の接続境界です。
言語の型推論や名前解決は行わず、診断・ホバー・補完などを `rhatls` に任せます。
ファイル監視はワークスペース、追加のモジュール探索先、指定された標準ライブラリを対象にし、
変更を `workspace/didChangeWatchedFiles` として通知します。

`src/server.ts` はサーバー探索とパス展開を扱う、VS Code API から独立した部分です。
明示設定、同梱バイナリ、開発時の隣のビルド、PATH の順で選択します。
引数は配列として渡し、シェルで文字列を評価しません。

再起動と停止は Promise の列で直列化します。短時間に複数の変更が来た場合は古い再起動要求を省き、
前のサーバーとファイル監視を破棄してから次を起動します。
初期起動に失敗してもコマンドは利用でき、エラーメッセージの応答待ちで再接続を止めません。
ワークスペースフォルダーが変わった場合も再初期化し、サーバーの探索情報を更新します。

`syntaxes/rhat.tmLanguage.json` は L^ の字句規則を参考にした TextMate 文法です。
R^ の組み込み型には `^` を要求し、配列・参照・ニル伝播・節の構文を扱います。
テーブル、動的な定義合成、補間文字列、`require^` などの未採用機能をキーワードとして案内しません。
文法は型を推測せず、正確な意味付けにはサーバーの semantic tokens を使います。
ハットの薄い灰色、単語演算子の青、複合代入の金色・太字は L^ 拡張と同じ既定設定です。
R^ のニル条件付き代入も複合代入と同じ強調にし、節名と未知のハット識別子の分類も L^ に揃えます。
サーバーは解決済みの名前だけを意味解析で色付けし、字句の配色を上書きしません。

`scripts/build.cjs` がバンドルの共通設定を持ちます。Debug はソースマップ付き、
Release は最小化・ソースマップなしで生成し、以前の Debug 用マップも除去します。
`vscode:prepublish` は Release を選ぶため、VSIX 作成時に開発用バンドルを配布しません。
`dist/extension.js` が配布用のバンドルです。`out/` は TypeScript の出力で、Node テストから
VS Code API 境界とパス解決を検証するためにも使います。VSIX には `out/` と開発用依存を含めません。
`scripts/notices.cjs` はバンドルする実行時依存のライセンスを集めます。

`testing/extension.test.cjs` は VS Code と LanguageClient の境界を差し替え、設定・監視・
再起動の直列化・停止・起動失敗からの復帰を検証します。`testing/grammar.test.cjs` は
VS Code と同じ TextMate / Oniguruma ライブラリでトークン化します。
`scripts/check-server.cjs` は実際のサーバーとの通信を検証します。

ビルド用の `vsce` には Azure 認証ライブラリの依存を固定しています。
`@azure/identity` 4.14 系の MSAL 依存と、古い MSAL の UUID 依存について、
報告されている advisory を避けるため `package.json` に局所的な override を置いています。
UUID の利用箇所は互換な `v4()` API です。これらは VSIX の実行時バンドルには含めません。
依存更新時には override と `npm audit` の結果も確認してください。
