# tdx 収集プレイブック

すべて **読み取り専用**。JSON が必要なときは `--json`、件数が多いときは `--limit` を付ける。出力のフィールド名は tdx のバージョンで変わることがあるので、最初の 1 件を見てから使うフィールドを決める。コマンドのリファレンス: https://tdx.treasuredata.com/commands/

## 0. 共通

```bash
tdx status                                  # プロファイル・site・アカウント
tdx databases --json                        # DB 一覧
tdx tables <db> --json                      # テーブル一覧（行数・更新日時が含まれれば使う）
```

`--site` / `--profile` はユーザーが指定したものだけを使う。

## 1. TD コンソール URL の解決

URL からは「種類を表す語」と「数値 ID または名前」を取り出し、一覧コマンドの結果と突き合わせて名前に解決する。パスの形は TD コンソールの版で変わるので、下の表は手がかりとして使い、合わなければユーザーに名前を聞く。

| URL に含まれる語（例） | 種類 | 解決方法 |
| --- | --- | --- |
| `workflows`, `projects` | Workflow | `tdx wf projects --json` / `tdx wf workflows --json` で ID を照合 |
| `databases`, `tables` | テーブル | パス中の DB 名・テーブル名、または `tdx tables` で照合 |
| `parentSegments`, `audiences`, `ms`, `cdp` | Parent Segment | **ID からは特定できない。必ずユーザーに名前を聞く**（下記） |
| `queries`, `saved` | Saved Query | `tdx job schedule list --json` で ID/名前を照合 |
| `sources`, `data-sources`, `connections`, `integrations` | Source | 下の「4. Source」へ |

### Parent Segment の URL は数値 ID から名前を推測しない

`tdx ps list` の出力には Parent Segment の数値 ID が含まれないため、`/app/dw/parentSegments/1389723` や `/app/ms/1389723` のような URL の ID を一覧と突き合わせても名前は特定できない。

- URL に数値 ID しか無い場合は、`tdx ps list` を実行した後でも推測せず、「この URL の Parent Segment 名を教えてください」とユーザーに直接確認する。
- アカウントのデフォルト DB（`tdx status` の database など）、DB 名、会話の文脈から Parent Segment を類推しない。デフォルト DB をもとに推測して、別の Parent Segment を対象にしてしまった事例がある。
- `tdx ps list` の一覧を見せて選んでもらうのはよい。ただし、選ばれるまで `ps view` / `ps pull` は行わない。

ドメインと site の対応: `console.treasuredata.com` = us01、`console.treasuredata.co.jp` = jp01、`console.eu01.treasuredata.com` = eu01、`console.ap02.treasuredata.com` = ap02。`console-next.` などの前置きが付くこともある。

## 2. Parent Segment

```bash
tdx ps list --json
tdx ps view "<name>"                         # 概要（ID・マスター・スケジュール）
tdx ps desc "<name>"                         # 出力スキーマ（cdp_audience_<id>.customers など）
tdx ps fields "<name>"                       # セグメントで使える属性・ビヘイビア（表示名 = 論理名の一次情報）
tdx ps pull "<name>"                         # 設定を YAML に保存（ローカルファイルのみ。push しない）
```

YAML から取り出すもの:

- マスターテーブル（`db.table`）と主キー
- 属性: 元テーブル・元カラム・**表示名**・結合キー → 論理名の判断材料（`inferred`。`metadata-rules.md` の「Parent Segment の表示名」）とリレーション
- ビヘイビア: 元テーブル・結合キー・表示名 → リネージ（元テーブル → `behavior_<元テーブル名>` → `parent_segment:<id>`）とリレーション
- 出力 DB（`cdp_audience_<id>`）の `customers` と `behavior_*`（下記「出力テーブル」）

### Parent Segment の元データ（必須）

Parent Segment が起点に指定されたら、**Parent Segment 用に作られる前の元データ**（マスター・属性・ビヘイビアが参照する元テーブル）も必ずカタログの対象にする。出力 DB `cdp_audience_<id>` のテーブルだけで終わらせない。

1. 名前から ID を得る: `tdx ps view "<name>"` で Parent Segment ID を確認する（名前 → ID はよい。ID → 名前の推測はしない）。
2. **構成ファイルで確認する**（先に行う）: `tdx ps pull "<name>"` の YAML から、マスター・各属性・各ビヘイビアの `database` / `table` と結合キーを列挙する。
3. **最新の実行ログで確認する**（構成ファイルで足りないとき、または実際に読まれたテーブルを裏付けるとき）: Parent Segment の更新 Workflow はプロジェクト `cdp_audience_<id>` として動いている。

   ```bash
   tdx wf attempts cdp_audience_<id> --json --limit 5       # 最新の成功した attempt を選ぶ
   tdx wf attempt <attempt-id> tasks --json                 # タスク一覧
   tdx wf attempt <attempt-id> logs "<task-name>"           # 各タスクのログ（実行 SQL）
   tdx wf timeline --attempt-id <attempt-id>                # 任意。タスクの流れの確認
   ```

   ログ中の SQL の `FROM` / `JOIN` から、`cdp_audience_<id>` 以外の DB のテーブルを元データとして拾う。
   - `attempt ... kill` / `retry`、`wf retry`、`ps run` は実行しない。
   - ログの全文はカタログに保存しない（必要なテーブル名・結合条件だけ取り出す）。ログに値が出ていても転記しない。
4. 元テーブルを対象テーブルに加え、スキーマ・論理名・サンプルなどを他のテーブルと同じ手順で作る。さらにその元テーブルの上流（Source・Workflow）へ 1 ホップ広げる。
5. リネージは「元テーブル → `customers` / `behavior_*` → `parent_segment:<id>`」（下記「出力テーブル」）。元テーブルから Parent Segment へ直接は張らない。根拠を `note` に書く（例: `ps pull の behaviors.orders` / `cdp_audience_1389723 attempt 123456 のログ`）。構成ファイルとログの両方で確認できたものは `exact`、片方だけなら `exact`（構成ファイル）または `inferred`（ログからの推定）。
6. 構成ファイルとログで元テーブルが食い違う場合（構成変更後に未実行など）は、両方をユーザーに示して、どちらを正とするか確認する。

### Parent Segment の出力テーブル（`cdp_audience_<id>`）

出力 DB のうち、次の 2 種類は **カタログの対象にする**。

| テーブル | 中身 | kind | 書き方 |
| --- | --- | --- | --- |
| `customers` | 属性（Attribute）に設定したテーブル群をマスターに結合し、**PIVOT して 1 顧客 1 行に集約** したもの | `segment_output` | 説明に「1行 = 1顧客（`cdp_customer_id`）」と属性の元テーブルを書く。各カラムの `description` に元の `<db>.<table>.<column>` を書き、元カラムの論理名・ID体系・コード値を引き継ぐ |
| `behavior_<元テーブル名>` | ビヘイビア（Behavior）に設定したテーブルを `cdp_customer_id` 付きに **エンリッチ** したもの | `segment_output` | 説明に元テーブルとビヘイビア名を書く。カラムは元テーブルの論理名を引き継ぎ、追加された `cdp_customer_id` などを補う |

- それ以外の `cdp_audience_<id>` 内の中間テーブル（作業用・一時テーブル）はカタログに個別に載せず、リネージ上は `parent_segment:<id>` にまとめる。
- スキーマは `tdx ps desc "<name>"` か information_schema（`table_schema = 'cdp_audience_<id>'`）で取る。
- リネージ:
  - 属性の元テーブル（マスター含む） → `table:cdp_audience_<id>.customers` → `parent_segment:<id>`
  - ビヘイビアの元テーブル → `table:cdp_audience_<id>.behavior_<元テーブル名>` → `parent_segment:<id>`
  - 元テーブル → 出力テーブルは type `transform`（Parent Segment の更新 Workflow `cdp_audience_<id>` による作成。`note` に根拠）、出力テーブル → Parent Segment は type `feeds`
  - Parent Segment → Activation / Segment は従来どおり Parent Segment から張る
- ER: `behavior_*.cdp_customer_id` → `customers.cdp_customer_id`（many-to-one）。元テーブルとの対応は、構成ファイルの結合キーで `customers` / `behavior_*` と元テーブルを結ぶ。
- 処理事例: Parent Segment の集計ビヘイビアやセグメント条件で使われる集計（例: 直近30日の購入金額）は、`behavior_*` テーブルを使う variant として `recipes` に書く。

`tdx activations "<ps名>/<segment名>"` で Activation が分かる場合は `activation:` ノードを追加してよい（接続設定の中身は書かない）。

## 3. Workflow

```bash
tdx wf projects --json
tdx wf workflows <project> --json
tdx wf schedules --json                      # スケジュール
tdx wf pull <project> data-catalog/_work/wf/<project>   # ローカルに取得（push しない）
```

取得したファイルを読み、各 `.dig` について次を抽出する。

| 記述 | 意味 |
| --- | --- |
| `td>: queries/x.sql` / `td>:` + `query:` | 実行 SQL。`database:` か `_export: td: database:` が既定 DB |
| `create_table:` / `insert_into:` | 書き込み先（DB 省略時は既定 DB） |
| `td_ddl>` | テーブルの作成・削除・リネーム（一時テーブルの判定に使う） |
| `td_load>: config/x.yml` | Source（データコネクタ取込）。yml の `in.type` がコネクタ種別、`out` の `database`/`table`/`mode` が取込先 |
| `td_run>: <name>` | Saved Query の実行 → `saved_query:<name>` とつなぐ |
| `call>` / `require>` | 他 Workflow の呼び出し（`workflow:` 同士のエッジ、type は `feeds`） |
| `td_for_each>` / `for_each>` | 展開値でテーブル名が変わる。展開して列挙する |
| `${...}` | `_export`、`!include` した yml、`config/*.yml` を追って解決。解決できなければ `confidence: unresolved` |

SQL からは:

- 入力: `FROM` / `JOIN` のテーブル（CTE 名・サブクエリ別名は除く）
- 出力: `INSERT INTO` / `INSERT OVERWRITE` / `CREATE TABLE ... AS` の対象
- **JOIN 条件**（`ON a.member_id = b.member_id`）→ `relationships.json` の候補
- **集計式**（`SUM(price * qty)`、`MAX(order_total)`、`COUNT(DISTINCT member_id)`）と `WHERE` の除外条件 → 処理事例の候補
- 列の別名（`AS 売上`）やコメント → 論理名の手がかり

## 4. Source（データコネクタ取込）

構造化された取得コマンドが無いため、次の順に情報を集める。

1. Workflow の `td_load>` 設定（最も確実）
2. ユーザーが `tdx api` を有効化している場合のみ: `tdx api /v3/bulk_loads`（一覧）。**有効化はユーザーに任せ、自分で設定を変えない。** 設定 JSON の認証情報は読み飛ばし、`type`・取込先・スケジュールだけを使う
3. ユーザーに聞く: コネクタ種別・取込先テーブル・頻度（TD コンソールの Sources 画面の URL があれば名前を確認）
4. 推定（最後の手段）: テーブル名（`shopify_*`、`sfdc_*`）や TD JS SDK の列（`td_client_id`、`td_url`）から推定し `confidence: inferred`

Source ノードの id は英小文字のスラッグ（`assets.sources[].id` と一致させる）。

## 5. Saved Query

```bash
tdx job schedule list --json
tdx job schedule show "<name>" --json
tdx job schedule history "<name>" --json --limit 5   # 最近の実行状況（任意）
```

- `query` を Workflow と同じ要領で解析し、`reads` / `writes` を埋める
- 結果出力（result）が TD テーブルなら `writes` に、外部出力なら `external:` ノードに。**result の URL・接続情報はそのまま書かない**（種類と出力先テーブル名だけ）

## 6. スキーマとプロファイル

### スキーマ（DB 単位でまとめて取得）

```sql
SELECT table_name, column_name, data_type, ordinal_position
FROM information_schema.columns
WHERE table_schema = '<db>'
ORDER BY table_name, ordinal_position
```

```bash
tdx query "<上の SQL>" --json
# 使えない場合はテーブルごとに
tdx describe <db>.<table> --json
```

### ID・コード値候補の軽量プロファイル

対象は、名前が `*id` / `*_no` / `*_code` / `*_key` / `*_cd` / `*_type` / `*_flag` / `*_status` のカラムと、`approx_distinct` が小さい varchar / int カラム。**`pii` が `personal` / `sensitive` のカラムは値を取らない。**

```sql
-- 形式の分布（値そのものは返さない。数字→9、英字→A に置換した「形」だけ）
SELECT
  length(CAST(c AS varchar)) AS len,
  regexp_replace(regexp_replace(CAST(c AS varchar), '[0-9]', '9'), '[A-Za-z]', 'A') AS shape,
  COUNT(*) AS rows
FROM <db>.<table>
WHERE td_interval(time, '-30d')
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 5
```

```sql
-- NULL 率と種類数
SELECT COUNT(*) AS rows, COUNT(c) AS non_null, approx_distinct(c) AS distinct_approx
FROM <db>.<table>
WHERE td_interval(time, '-30d')
```

```sql
-- コード値（種類数が 30 以下のカラムだけ）
SELECT c, COUNT(*) AS rows
FROM <db>.<table>
WHERE td_interval(time, '-30d')
GROUP BY 1
ORDER BY 2 DESC
LIMIT 30
```

`time` 列が無いテーブル（マスター等）は `td_interval` を外し、`TABLESAMPLE BERNOULLI (1)` などで軽くする。重そうなら件数を確認してから実行する。

### 結合の裏付け（一致率）

```sql
WITH a AS (
  SELECT DISTINCT CAST(<col_a> AS varchar) AS v
  FROM <db_a>.<table_a>
  WHERE td_interval(time, '-30d') AND <col_a> IS NOT NULL
  LIMIT 100000
),
b AS (
  SELECT DISTINCT CAST(<col_b> AS varchar) AS v
  FROM <db_b>.<table_b>
  WHERE <col_b> IS NOT NULL
)
SELECT COUNT(*) AS sampled, COUNT(b.v) AS matched,
       ROUND(100.0 * COUNT(b.v) / COUNT(*), 1) AS match_pct
FROM a LEFT JOIN b ON a.v = b.v
```

- 一致率 90% 以上 → `confirmed` 候補（JOIN 定義があれば確定）。50〜90% → `inferred`。それ未満 → 別体系の可能性。ID体系の問い合わせに使う。
- 片側が一意か（`COUNT(*)` と `approx_distinct` がほぼ同じ）でカーディナリティを決める。

### マスク付きサンプル

`references/metadata-rules.md` の「サンプルのマスク」で SELECT 句を組み立てる。

```sql
SELECT <マスク式を含む列リスト>
FROM <db>.<table>
WHERE td_interval(time, '-7d')
LIMIT 3
```

### サンプルクエリの検証

載せる前に、`LIMIT 1` を付けて `tdx query` で実行し、エラーが無いことを確認する（集計結果の値はカタログに書かない）。

## 7. ファイルへの書き出し

- テーブル: `tables/<db>/<table>.json`
- リネージ・ER・用語・アセット: ルートの各 JSON
- 書き終えたら `node $SKILL/scripts/catalog-cli.mjs validate data-catalog/catalog`
- `data-catalog/_work/`（pull した Workflow など）はカタログ ZIP に含めない（catalog ディレクトリの外に置く）
