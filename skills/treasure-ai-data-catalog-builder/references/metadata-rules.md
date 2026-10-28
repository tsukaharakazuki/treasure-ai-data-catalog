# メタデータ作成ルール

## 論理名

### 情報源の優先順位と status

| 順位 | 情報源 | `logical_name_status` |
| --- | --- | --- |
| 1 | ユーザーが確認・指定した名前 | `confirmed` |
| 2 | TD に登録済みの説明・既存ドキュメント | `confirmed` |
| 3 | Parent Segment の属性・ビヘイビアの表示名、日本語名・名前変換の設定（`tdx ps fields` / `ps pull` の YAML） | `inferred`（下記） |
| 4 | Workflow / Saved Query の SQL の別名（`AS 売上`）・コメント | `inferred` |
| 5 | カラム名・型・集計プロファイル（桁数・NULL率・種類数）からの推定 | `inferred` |
| — | 意味が複数考えられる、ID体系が未確定 | `needs_review` |

### Parent Segment の表示名・名前変換の扱い

Parent Segment に日本語の表示名や名前変換の指示が設定されていても、**人が手で入力したものなので正確とは限らない**。判断材料の一つとして使い、そのまま確定扱いにしない。

- 表示名と、カラム名・型・集計統計と仕様書・元テーブルの説明・SQL の使われ方を突き合わせる。矛盾が無ければ表示名を採用し `inferred`、ユーザーが確認したら `confirmed`。
- 矛盾がある（例: 表示名は「購入日」だが定義書では UNIX 秒の取込時刻、表示名は「会員ID」だが形式がブラウザID）場合は `needs_review` にし、説明に「Parent Segment の表示名は『○○』」と根拠を残して、ユーザーに確認する。
- 表記ゆれ（「会員ＩＤ」「会員id」「会員番号」）や、同じ元カラムに別の表示名が付いているものは、カタログ側で正規化した名前（全テーブルで共通の論理名）を採用し、元の表示名は `description` に残す。
- 正規化した結果を Parent Segment の設定に反映してほしいと依頼されたら、SKILL.md の「Parent Segment への反映モード」に従う。

### 書き方

- **利用者の言語**（`catalog.json` の `language`）で、名詞句にする。例: `注文日時（JST）`、`注文合計金額（税込）`、`会員ステータス`
- 単位・税込/税抜・タイムゾーン・粒度が分かれば括弧で添える
- `flag` / `type` / `kbn` などは仕様書・ユーザーの説明で意味を確認し、`values` に確認済みのコード定義だけを書く（`{"0": "未退会", "1": "退会"}`）
- 同じ意味のカラムはテーブルをまたいで同じ論理名にする（`member_id` はどこでも `統合会員ID`）
- 推測で業務固有の名前を作らない。分からなければ `needs_review` にして説明に推定根拠を書く

### TD の標準カラム

| カラム | 論理名 |
| --- | --- |
| `time` | データ時刻（UNIX秒）※取込時刻かイベント時刻かを説明に書く |
| `td_client_id` | ブラウザID（TD Client ID） |
| `td_global_id` | グローバルID（TD Global ID） |
| `td_url` / `td_path` / `td_title` / `td_referrer` | ページURL / パス / ページタイトル / 参照元URL |
| `td_ip` | IPアドレス（`pii: personal`） |
| `td_user_agent` / `td_browser` / `td_os` | ユーザーエージェント / ブラウザ / OS |
| `cdp_customer_id` | CDP顧客ID（Audience Studio が採番） |

### テーブル

- `logical_name`: 業務上の呼び名（`EC注文`、`会員マスタ`）
- `description`: **1行 = 何か**（粒度）、取込元または作成処理、含む/含まないもの（キャンセル含む等）
- `usage`: 下流（Workflow / Saved Query / Parent Segment / BI）の使われ方から 2〜4 個
- `update_frequency`: Source / Workflow / Saved Query のスケジュールから

## ID体系

### 判定の手順

1. ID 候補カラムを集める（名前が `*id` / `*_no` / `*_code` / `*_key`、または一意性が高い varchar / bigint）
2. 集計プロファイル（`collection-playbook.md`）で長さの最小・最大、数字形式の件数、NULL率、種類数を取る。ID実例や文字置換した shape は取らない
3. 形式と名前でグループ化し、グループ間・グループ内で一致率を測る
4. 次のどれかに当たるものは **ユーザーに問い合わせる**
   - 同名なのに形式が違う（例: `customer_id` が A テーブルでは10桁数字、B テーブルでは `C` + 7桁）
   - 別名なのに形式が同じで一致率が高い（例: `member_no` と `kaiin_id`）
   - 汎用名（`id` / `user_id` / `customer_id`）が複数テーブルにある
   - 1 カラムに複数の形式が混在する（旧番号と新番号の混在など）

### 問い合わせの書き方（例）

> 会員を表すIDが複数見つかりました。同じ体系かどうか、正式名称を教えてください。
>
> | グループ | 形式 | 該当カラム | 推定 |
> | --- | --- | --- | --- |
> | A | 10桁の数字 | crm_members.member_id, web_pageviews.member_id | 統合会員ID？ |
> | B | "C" + 7桁 | shopify_orders.customer_id, crm_members.ec_customer_id | EC会員番号？ |
> | C | "29" で始まる13桁 | pos_transactions.member_card_no | ポイントカード番号？ |
>
> A と B は crm_members で対応付いているように見えます（一致率 97%）。

回答を `glossary.json` の `id_systems` に書く（`status: confirmed`）。形式の説明と桁数だけを記録し、`example_masked` などのID実例はマスク済みでも書かない。上の表の形式は説明用の架空仕様であり、実値から接頭辞を抽出しない。

## 個人情報の区分（pii）

| 区分 | 例（カラム名の手がかり） |
| --- | --- |
| `identifier` | 会員ID、顧客番号、`td_client_id`、`cdp_customer_id`、端末ID（`idfa` / `adid` / `gaid`）、カード番号（下記を除く） |
| `personal` | 氏名（`name` / `sei` / `mei` / `kana`）、メール（`email` / `mail`）、電話（`tel` / `phone` / `mobile`）、住所（`address` / `addr` / `zip` / `postal`）、IP（`ip` / `td_ip`）、位置（`lat` / `lon`）、自由記述（`comment` / `memo` / `note` / `body` / `message` / `inquiry`） |
| `sensitive` | 生年月日（`birth` / `dob`）、決済（`credit` / `card_number`）、健康・信条など |
| 除外 | `password` / `passwd` / `token` / `secret` / `api_key` → **カタログに値を一切載せない**（カラム定義のみ） |

迷ったら重い方に倒す。

## 行サンプルの取得・保存は禁止

- PII区分にかかわらず、実データの行は取得しない。マスク・部分伏字・ハッシュ・文字置換も例外にしない。
- `samples` と `example_masked` は現在のテーブルにも過去のスナップショットにも置かない。`privacy.sample_rows_max` は 0 のみ（省略も可）。ユーザーに取得可否を選ばせない。
- カタログにはスキーマ・仕様上の意味・コード定義・集計統計・SQLテキストだけを記録する。チャット・ログ・MEMORY.md・ZIP・生成SKILLにも行データを転記しない。
- CLI検証は旧フィールドを拒否するが、自由記述・SQL・ログ中のあらゆる個人情報を検出する保証はない。取得時点から行データを扱わないことが境界になる。

## 処理事例（recipes）

- **指示文（instruction）** は利用者が実際に言う形で書く（「売上の合計を出して」「購入者数を出して」）。言い換えは `aliases`
- 同じ指示を計算できる **すべてのテーブル** について `variants` を作る。式が同じでも条件（キャンセル除外、会員のみ）が違えば別に書く
- `expression` は SQL の式、`conditions` は WHERE / JOIN の条件、`notes` は違いと注意（送料・税・重複・粒度）
- その指示に使ってはいけないテーブルは `（使用不可）` として理由を書く（例: 日次集計の購入者数は期間で足せない）
- 一次情報（Workflow / Saved Query の SQL、ユーザーの説明）に無い式は、ユーザーに確認してから載せる
