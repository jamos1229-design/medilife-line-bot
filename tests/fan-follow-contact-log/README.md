# ファン化フォロー「フォロー・接触記録」（電話フォロー専用設計の廃止）テスト

既契約者フォローの記録を、「電話フォロー（任意）」専用の設計から「フォロー・接触記録」
（1 contact = 1回の接触、時系列で何回でも記録）へ再設計した改修と、そのAI分析出力
（接触履歴明細）の、合成データのみのテスト群です。実データ・顧客情報・認証情報は一切含みません。

対象コード：`nexus.html`（`n.html`と同一内容）。既存のファン化フォロー機能（キャンペーン管理・
相談化橋渡し・紹介管理・次にすること・既存のAI分析用データ出力の各セクション）は変更せず、
接触記録まわりと、新しいAI分析出力セクション（接触履歴明細）だけを追加しています。

## 構成

| ファイル | 内容 | 依存 |
|---|---|---|
| `pure.test.js` | 純粋関数の単体テスト（初回送付の仮想contact、旧スカラー項目（readAt/repliedAt/phoneFollowStatus）からの仮想contact変換、旧データ・新データのマージ＋重複排除（`nexusFanNormalizedContacts`、method・result・日付の完全一致での重複判定）、タイムライン・直近接触の算出、接触方法別集計、read/replied集計の重複排除込み計算、「次にすること」タスク同期の汎用化（source指定）・冪等性・削除、AI分析出力「接触履歴明細」（1 contact = 1行、`nexusFanContactDetailRows`）の自由記述除外・contactSequence／daysFromInitialSendの算出・CSV化） | Node.jsのみ |
| `e2e-contact-log-flow.test.js` | 方法→結果の2タップ記録、同じ方法でも送信と返信は別接触になること（方法と結果を合成しない）、相談になった場合のボタン強調、次回フォロー（日・方法・内容）の既存「次にすること」への反映と増殖防止、紹介あり（人数・メモ）と既存referredByでの顧客登録連携、面談予定と面談実施の区別、旧データ（電話フォロー）が無関係な新接触の追加後も消えないこと（マージ）・完全一致する場合だけ重複排除されること、一覧カードの直近接触＋次回表示、バックアップ／復元での接触履歴保持、iPhone幅(390px)、AI分析出力（接触履歴明細）の実際のクリップボードコピーで自由記述が一切含まれないことの確認 | Playwright + ローカルHTTPサーバー |

## 依存関係

- Node.js 18以上
- `pure.test.js`はNode.js標準機能のみで動作し、追加インストール不要です。
- `e2e-contact-log-flow.test.js`は[Playwright](https://playwright.dev/)を使用し、`tests/dot-bridge/vendor/`配下の
  React本体のローカルコピーをそのまま再利用します（CDNへの依存を避けるため）。

## 実行手順

1. リポジトリのルートで、`nexus.html`を配信するローカルHTTPサーバーを起動します（E2Eテストのみ必要）。
   ```sh
   python3 -m http.server 8794
   ```
   （別のポートを使う場合は、`e2e-contact-log-flow.test.js`内の`http://localhost:8794/`をあわせて変更してください）

2. 別のターミナルで、リポジトリのルートから各テストを実行します。
   ```sh
   # 純粋関数テスト（Playwright不要）
   node tests/fan-follow-contact-log/pure.test.js

   # E2Eテスト（手順1のサーバーが起動している状態で実行）
   node tests/fan-follow-contact-log/e2e-contact-log-flow.test.js
   ```
   Playwrightパッケージが`node_modules`から解決できない環境では、`NODE_PATH`にPlaywrightのインストール先を追加してください。

3. 各テストは標準出力に`PASS`/`FAIL`を1件ずつ出力し、最後に合計件数を表示します。`FAIL`が1件でもあれば終了コード1で終わります。

## 確認済みの結果（2026年10月、合成データ）

| テスト | 件数 |
|---|---|
| `pure.test.js` | 75 PASS / 0 FAIL |
| `e2e-contact-log-flow.test.js` | 38 PASS / 0 FAIL |

既存の`tests/lifeplan/`（126+40件）・`tests/dot-bridge/`（82+135件）・`tests/dot-bridge-phase2/`
（54+97件）も、今回の変更後に再実行し、すべてPASSすることを確認しています（回帰確認）。

## 旧データ・新データのマージと重複排除（二者択一ではない）

- **初回送付**（`sentDate`／`sendMethod`）は、`contacts`配列とは別系統の、常に1件だけ存在する
  恒久的な出来事として扱います。`contacts`側に「初回送付」に相当する項目を作ることは無いため、
  新しい接触を何件追加しても初回送付の履歴は消えません。
- **以降の接触（既読・返信・電話結果等）**：この改修以降、新しい記録UIは
  `readAt`／`repliedAt`／`phoneFollowStatus`／`phoneFollowDate`へ二度と書き込みません。
  旧スカラー項目から作る仮想contactと、`contacts`実データは**常にマージ**します
  （「旧データが空なら旧／1件でもあれば新のみ」という二者択一ではありません）。
  重複しているものだけ、`method`・`result`・`occurredAt`（日付）の完全一致で取り除きます
  （両者とも時刻を持たない日付文字列で精度が揃っているため、完全一致判定で安全です）。
  この正規化は`nexusFanNormalizedContacts(record)`という1つの共通関数に統一し、タイムライン・
  一覧の直近接触・ダッシュボードの既読/返信集計・接触方法別集計・AI分析出力（接触履歴明細）の
  すべてがこの関数の結果だけを見ます。
- 既存の保存データ（`readAt`等）自体は削除・書き換えしません。上記はすべて表示・集計時の
  読み替えであり、バックアップ・復元でもそのまま保持されます。

## 既存機能の再利用（二重実装の回避）

- 「次にすること」：新しい簡易タスク機能は作らず、既存の`nexusSyncNextThingTasks`（商談メモの
  「自分がやること／返事待ち／次の面談・連絡」と同じtasksストア・同じ編集UI）を`source`パラメータ
  （`fanFollowTask`）だけ追加して再利用しています。ホーム「次にすること」・顧客詳細の
  「次にすること」カードにもそのまま表示されます。
- 「相談になった」→相談・問合せ登録：既存の橋渡し（`NexusActivityForm`への事前入力）を変更せず、
  結果が「相談になった」の時だけボタンを強調表示するようにしています。
- 「紹介あり」：紹介人数・紹介者メモは接触記録にだけ保持し、紹介人数のKPIは引き続き既存の
  `nexusReferralCount`（`customer.referredBy`の集計）を唯一の正とします。「紹介された方を登録する」
  ボタンから既存の顧客登録画面（`referredBy`事前入力）を開き、登録後に接触記録側の
  `referredCustomerIds`へ新しい顧客のidを残すことで、将来どちらからでも辿れるようにしています
  （`referredCustomerIds`自体を集計するコードはどこにも無く、独立した紹介台帳にはなっていません）。

## AI分析出力：接触履歴明細（案B、1 contact = 1行）

既存の「キャンペーン個別進捗明細」（1記録＝1行）は変更せず、新しいセクション
「接触履歴明細」を追加しました（`nexusFanContactDetailRows`／CSVの`nexusFanFollowContactDetailCsvRows`）。

- **匿名化を最優先**：`memo`／`referralMemo`／`meetingPurpose`／`messageText`／`customerNameText`
  等の自由記述は、出力オブジェクトのキーとして一切含めません（既存の残留PII走査に検出させるの
  ではなく、そもそも出力対象に入れない設計です）。出力するのは固定の選択肢（`direction`／`method`／
  `result`／`topics`／`meetingMode`）と、個人情報を含まない数値（`referralCount`／
  `contactSequence`／`daysFromInitialSend`）だけです。
- **識別子**：`code`は既存の`customer.aiAnalysisId`、`campaignId`は`campaign.id`（`uid()`生成の
  ランダム文字列）をそのまま使います。自由入力の`campaignName`はこのセクションでは使いません。
- **eventType**：`initial_send`（初回送付、`contactSequence=0`／`daysFromInitialSend=0`）と
  `followup_contact`（以降の接触、`contactSequence=1,2,3...`／`daysFromInitialSend`＝初回送付からの
  経過日数）を区別します。「LINEで初回送付」と「フォローとしてLINE」をAIが混同しないためです。
  既存のダッシュボード集計（初回送付チャネル集計=`nexusFanMethodBreakdown`、以降の接触方法別集計=
  `nexusFanContactMethodBreakdown`）は、この明細とは別物のまま変更していません。
- **contactSequenceは「発生順」（最新からではなく最古から1,2,3...）**：`nexusFanNormalizedContacts`
  自体は画面のタイムライン表示用に新しい順（降順）のままで、これは変更していません。
  `nexusFanContactDetailRows`の中でだけ、その結果を日時の古い順に並べ直してから
  `contactSequence`を付与します（最新接触から1を振る設計にはしていません）。初回送付は別に
  `contactSequence=0`／`daysFromInitialSend=0`として先頭に置きます。
- **同日の接触の順序**：`occurredAt`は時刻を持たない`YYYY-MM-DD`のみです（新規UIの`occurredAt`も
  旧データ由来のものも同様）。同じ日に複数の接触がある場合、主キー（`occurredAt`）だけでは
  前後関係が決まらないため、`createdAt`（実際に記録された時刻。`contacts`実データのみが持つ）を
  補助キーとして使います。`createdAt`を持たない旧データ（readAt／repliedAt／phoneFollowStatusから
  の仮想contact）が同日の新データと重なった場合、実際の前後関係はデータから判断できないため、
  推測はせず「旧データを先に置く」という固定の規約で順序を一意に決めています（真の前後関係を
  主張するものではありません）。これが制約です：**同日かつ旧データが絡む場合の正確な前後関係は、
  保存されているデータからは判断できません。**
- **相談化／面談化／紹介化フラグの対象result**（取りこぼし確認のため、全17種のresultに対して
  網羅的にテスト済み）：

  | フラグ | trueになるresult | 備考 |
  |---|---|---|
  | `consultedFlag` | `相談になった` | 他のresultでは発生しない |
  | `metFlag` | `面談実施` | `面談予定`はfalse（「予定を入れた＝面談した」にしないため、意図的に除外） |
  | `referredFlag` | `紹介あり` | 他のresultでは発生しない |

  3つのフラグが同時にtrueになるresultは存在しません（排他）。
- `followup_contact`の並びは`nexusFanNormalizedContacts`（マージ＋重複排除済み）の結果を使うため、
  旧データ・新データが混在していても二重計上されません。初回送付と同日・同方法・同結果の
  contactsデータが存在していても、`initial_send`行は常に1件だけです（contacts側には
  「初回送付」に相当する項目が別途作られないため）。

## 残る制約（未確認・未実装の範囲）

- 面談予定の日時・形式・目的はデータとして保持しますが、Googleカレンダーへの自動登録は
  行いません（将来対応しやすいようデータ構造だけ用意しています）。
- 未登録の相手（`customerNameText`のみ）に対する紹介・面談等のcontacts記録も可能です。ただし
  「紹介された方を登録する」から作成する新規顧客の`referredBy`は、紹介元がまだ未登録の場合は
  空のまま（紐付け無し）になります。紹介元を正式登録してから使うことを想定しています。
- `referredCustomerIds`は、「紹介を登録」操作の時点だけ書き込まれる一方向の参照です。後から
  顧客側の`referredBy`を別途編集・修正しても、`referredCustomerIds`は自動的に追従しません。
