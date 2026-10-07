# Dot連携（第1段階）テスト

記憶↔既存タスクの橋渡し、安全なDot用JSON出力、PRIVATE保護、保存失敗への対処を
検証する合成データのみのテスト群です。実データ・顧客情報・認証情報は一切含みません。

対象コード：`nexus.html`（`n.html`と同一内容）。

## 構成

| ファイル | 内容 | 依存 |
|---|---|---|
| `pure.test.js` | 純粋関数の単体テスト（PRIVATE判定・関連付け事前判定・参照ID／版トークン・JSON許可リスト検証・保存ヘルパー） | Node.jsのみ |
| `e2e-link-and-export.test.js` | 記憶↔タスク関連付け〜Dot用JSON確認〜コピーの一連の画面操作、既存AI分析パックへのPRIVATEガード、機能停止スイッチ | Playwright + ローカルHTTPサーバー |
| `e2e-integrity-and-locks.test.js` | 版番号の非内容依存性、PRIVATE候補の誤検知解除、由来不明AI Insightのブロック、コピー直前の鮮度再確認（別タブでのPRIVATE化・本文変更）、複数タブでの同一タスク競合、Web Locks非対応時の停止、中断からの復旧 | Playwright + ローカルHTTPサーバー |
| `e2e-iphone-widths.test.js` | 375/390/430px幅での横スクロール・要素のあふれ・タップ領域確認（ブラウザのビューポート幅テスト、実機確認ではない） | Playwright + ローカルHTTPサーバー |
| `e2e-fault-injection.test.js` | `localStorage.setItem`・IndexedDBの`put()`へ実際に例外を注入し、保存失敗時に成功表示・JSON出力をしないこと、重複やデータ消失が起きないことを検証 | Playwright + ローカルHTTPサーバー |
| `e2e-review-fixes.test.js` | 公開コード確認で見つかった2件の保存問題（①別タブ追加タスクが古いReact状態で消える／②新規作成retry時の重複タスク作成）の再現と修正確認 | Playwright + ローカルHTTPサーバー |
| `vendor/` | E2EテストがCDN（unpkg.com）へ依存せず動くようにするためのReact本体のローカルコピー（React 18 UMD production build） | なし（静的ファイル） |

## 依存関係

- Node.js 18以上
- `pure.test.js`はNode.js標準機能のみで動作し、追加インストール不要です。
- E2Eテスト（`e2e-*.test.js`）は[Playwright](https://playwright.dev/)（`playwright`パッケージ）を使用します。本リポジトリの`package.json`には含めていないため、実行環境に応じて以下のいずれかを用意してください。
  - `npm install -D playwright && npx playwright install chromium`（Chromiumを新たにダウンロード）
  - 既にシステム上にPlaywright本体とChromiumがある場合は、`PLAYWRIGHT_CHROMIUM_PATH`環境変数でChromiumの実行ファイルパスを指定できます（未指定ならPlaywrightが自動検出した既定のChromiumを使用）。

## 実行手順

1. リポジトリのルートで、`nexus.html`を配信するローカルHTTPサーバーを起動します（E2Eテストのみ必要。`pure.test.js`は不要）。
   ```sh
   python3 -m http.server 8791
   ```
   （別のポートを使う場合は、各`e2e-*.test.js`内の`http://localhost:8791/`をあわせて変更してください）

2. 別のターミナルで、リポジトリのルートから各テストを実行します。
   ```sh
   # 純粋関数テスト（Playwright不要）
   node tests/dot-bridge/pure.test.js

   # E2Eテスト（手順1のサーバーが起動している状態で実行）
   node tests/dot-bridge/e2e-link-and-export.test.js
   node tests/dot-bridge/e2e-integrity-and-locks.test.js
   node tests/dot-bridge/e2e-iphone-widths.test.js
   node tests/dot-bridge/e2e-fault-injection.test.js
   node tests/dot-bridge/e2e-review-fixes.test.js
   ```
   Playwrightパッケージが`node_modules`から解決できない環境では、`NODE_PATH`にPlaywrightのインストール先を追加してください（例：`NODE_PATH=/path/to/playwright/node_modules node tests/dot-bridge/e2e-link-and-export.test.js`）。

3. 各テストは標準出力に`PASS`/`FAIL`を1件ずつ出力し、最後に合計件数を表示します。`FAIL`が1件でもあれば終了コード1で終わります。

## 確認済みの結果（2026年10月、合成データ）

| テスト | 件数 |
|---|---|
| `pure.test.js` | 82 PASS / 0 FAIL |
| `e2e-link-and-export.test.js` | 31 PASS / 0 FAIL |
| `e2e-integrity-and-locks.test.js` | 29 PASS / 0 FAIL |
| `e2e-iphone-widths.test.js` | 47 PASS / 0 FAIL |
| `e2e-fault-injection.test.js` | 20 PASS / 0 FAIL |
| `e2e-review-fixes.test.js` | 8 PASS / 0 FAIL |

（上記に加え、商談メモ・支払免除・解約返戻金税務・資料出力範囲・記憶バックアップ等の既存機能に対する回帰確認もすべてPASSしていますが、それらのテストファイル自体はこのリポジトリには含まれていません。）

## 残る制約（未確認の範囲）

- 3タブ以上での同時競合は未検証です（2タブでの競合のみ確認済み）。
- 実機でのストレージ容量超過の再現は行っていません（`e2e-fault-injection.test.js`では`Storage.prototype.setItem`・`IDBObjectStore.prototype.put`を一時的に上書きして例外を注入する方式で代替しています）。
- Web Locks API非対応ブラウザでの複数タブ同時操作そのものは、新しい関連付け操作を停止する設計のため検証対象外です。
