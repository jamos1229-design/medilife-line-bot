# サスペクトツリー テスト

人脈タブの「サスペクトツリー」（自分 → 顧客 → 紹介でつながった顧客・候補者・家族）の、
合成データのみのテスト群です。実データ・顧客情報・認証情報は一切含みません。

対象コード：`nexus.html`（`n.html`と同一内容）。新しい保存先は作らず、既存の
`customers_v1`（顧客・紹介元・顧客ごとのサスペクト）、`ml_suspects_v1`（サスペクトリスト）、
ファン化フォローの接触記録を読んで1枚のツリーにまとめます。この画面が書き込むのは
`networkCategory`（人脈分類の手動指定）と`referrerCustomerId`（候補者の紹介元顧客）の2項目だけです。

| ファイル | 内容 | 依存 |
|---|---|---|
| `pure.test.js` | 状態判定（既契約／相談中／未接触）、人脈5分類の自動判定と手動指定、紹介元の親子解決（未登録・循環の除外）、名前一致だけでは自動接続しないこと、枝ごとの集計、最終接触日と要フォロー判定、絞り込み、空・壊れたデータ | Node.jsのみ |
| `e2e-suspect-tree.test.js` | 画面表示、折りたたみ、候補者を顧客へつなぐ、分類の手動指定、候補者追加、絞り込み、顧客詳細への遷移、iPhone幅(390px) | Playwright + ローカルHTTPサーバー |

## 実行手順

```sh
# 純粋関数テスト
node tests/suspect-tree/pure.test.js

# E2Eテスト（リポジトリ直下で python3 -m http.server 8794 を起動した状態で）
node tests/suspect-tree/e2e-suspect-tree.test.js
```

## 確認済みの結果（2026年11月、合成データ）

| テスト | 件数 |
|---|---|
| `pure.test.js` | 45 PASS / 0 FAIL |
| `e2e-suspect-tree.test.js` | 23 PASS / 0 FAIL |
