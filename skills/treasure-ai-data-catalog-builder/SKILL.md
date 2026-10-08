---
name: treasure-ai-data-catalog-builder
description: "Treasure Data 環境のデータカタログを tdx の読み取り専用コマンドで作成・定期更新し、ビューアー（Treasure AI Data Catalog）で開ける ZIP と、誰でも使える <name>-data-catalog SKILL を生成する。メタデータ（スキーマ・利用者の言語での論理名・説明・利用用途・マスク済みサンプルデータ）、データリネージ（Source / Workflow / Saved Query / Parent Segment とテーブル）、ER図、テーブル別サンプルクエリ、リビジョン管理と差分、社内用語とテーブル別の処理事例集（「売上の合計」→ SUM(単価*個数) / MAX(注文合計金額) など）を扱う。Trigger on 「データカタログを作って」「データカタログを更新」「テーブル定義書を作りたい」「論理名を付けて」「リネージを可視化」「ER図を作って」「メタデータを整備」「<顧客名>-data-catalog を作って」「正規化した論理名をパーセグに反映して」「Parent Segment の表示名を直して」, data catalog, metadata catalog, data lineage, ER diagram for Treasure Data, or /treasure-ai-data-catalog-builder."
---

# Treasure AI Data Catalog Builder

Treasure Data の Parent Segment / Workflow / Saved Query / Source / データベースを起点にデータカタログを作り、ZIP と `<name>-data-catalog` SKILL を出力する。

- 形式の定義: `references/catalog-format.md`（必読。ファイル構成・フィールド・ノード ID 規約）
- tdx での収集手順とクエリ: `references/collection-playbook.md`
- 論理名・ID体系・サンプルのマスク: `references/metadata-rules.md`
- CLI: `scripts/catalog-cli.mjs`（Node.js 18 以上、依存なし。TD には接続しない）

以下、この SKILL のディレクトリを `$SKILL` と書く。リポジトリから読んでいる場合は `skills/treasure-ai-data-catalog-builder` を指す。

## 絶対に守ること

1. **tdx は読み取り専用で使う**（唯一の例外は「Parent Segment への反映モード」での、ユーザー承認後の `tdx ps push`）。 `wf run` / `wf push` / `wf upload` / `wf delete` / `wf retry` / `wf attempt ... kill|retry` / `ps run` / `ps push` / `sg push` / `journey resume` / `job schedule run|create|update|delete` / `job submit` での書き込み、`CREATE` / `INSERT` / `DELETE` / `DROP` を含む SQL は実行しない。
2. **`tdx api` を自分で有効化しない。** 無効のままなら他の手段（Workflow の `td_load>` 設定、ユーザーへの質問）で補う。
3. **個人情報を生で取得しない。** サンプル取得はマスク式を SQL に組み込んで行う（`references/metadata-rules.md`）。氏名・メール・電話・住所・生年月日・自由記述は ZIP に生値を入れない。
4. **重いクエリを投げない。** `time` 列があるテーブルは必ず `td_interval(time, '-7d')` などで絞り、`LIMIT` と `approx_distinct` を使う。フルスキャンになるプロファイリングは確認してから行う。
5. **推測を確定扱いしない。** 推定した論理名・リネージ・リレーションには `inferred` / `needs_review` を付ける。
6. API キー・トークン・Webhook URL・接続情報をファイルにもチャットにも出さない。

## モードの判定

- 前回のカタログ ZIP が添付された、または「更新」と言われた → **更新モード**（末尾）
- カタログで正規化した論理名を Parent Segment の設定（属性・ビヘイビアの表示名）に反映してほしいと言われた → **Parent Segment への反映モード**（末尾）
- それ以外 → **新規作成**

## 新規作成の手順

### 1. ヒアリング（1回のメッセージでまとめて聞く）

次を質問する。選択肢があるものは選択肢で示す。

1. **カタログの起点**（複数選択可）: Parent Segment（Audience Studio）/ Workflow プロジェクト / Saved Query / Source（データコネクタ取込）/ データベース指定
2. **対象の名前、または TD コンソールの URL**（複数可）。例: Parent Segment 名、Workflow プロジェクト名、`https://console.treasuredata.com/...` の URL。**Parent Segment は URL だけでは特定できないので、名前も一緒に聞く**
3. **サンプルデータ**: 含める（マスク済み・各テーブル10行、既定）/ 含めない
4. **論理名・説明の言語**: 既定はユーザーの言語（日本語なら `ja`）
5. **社内用語や、よく出る集計指示**があれば（例: 「売上」「購入者数」「アクティブ会員」の定義）。後でも構わないと伝える

顧客名・サービス名は **手順 9 で** 聞く（情報が出揃ってから決める）。

### 2. 接続先の確認

`tdx status` でプロファイル・サイト・アカウントを確認し、ユーザーに提示する。URL のドメインと site が食い違う（例: `console.treasuredata.co.jp` なのに us01）場合は、`--site` / `--profile` の指定をユーザーに確認する。

### 3. 作業ディレクトリの初期化

```bash
node $SKILL/scripts/catalog-cli.mjs init data-catalog/catalog --name draft --lang ja --site <site>
```

`catalog.json` の `scope` に、手順 1 で受けた対象と URL（`scope.inputs`）を記録する。

### 4. 対象の解決と収集

`references/collection-playbook.md` の該当節に従って収集する。起点ごとの要点:

| 起点 | 主なコマンド | 得るもの |
| --- | --- | --- |
| Parent Segment | `tdx ps view` / `tdx ps pull` / `tdx ps desc` / `tdx ps fields`、`tdx wf attempts cdp_audience_<id>` → `tdx wf attempt <id> logs` | **元データ**（マスター・属性・ビヘイビアの元テーブル）、結合キー、出力DB（`cdp_audience_<id>`）、属性の表示名（論理名の判断材料。人が入力したものなので確定扱いにしない） |
| Workflow | `tdx wf projects` → `tdx wf pull <project> <dir>` / `tdx wf workflows` / `tdx wf schedules` | `.dig` と SQL から読み書きテーブル、`td_load>`（Source）、`td_run>`（Saved Query）、JOIN 条件、集計式 |
| Saved Query | `tdx job schedule list` → `tdx job schedule show <name>` | SQL・DB・スケジュール・出力先 |
| Source | Workflow の `td_load>` 設定、（ユーザーが有効化済みなら）`tdx api`、ユーザーへの確認 | コネクタ種別・取込先テーブル・スケジュール |
| データベース | `tdx tables <db>` | テーブル一覧 |

**Parent Segment が指定された場合は、Parent Segment 用に作られる前の元データも必ず対象にする。** まず構成ファイル（`tdx ps pull` の YAML）でマスター・属性・ビヘイビアの元テーブルを列挙し、足りなければ Workflow プロジェクト `cdp_audience_<Parent Segment ID>` の最新の実行ログ（`tdx wf attempts` → `tdx wf attempt <id> tasks` / `logs`）の SQL から元テーブルを拾う。手順は `references/collection-playbook.md` の「Parent Segment の元データ」。

出力 DB `cdp_audience_<id>` の `customers`（属性テーブル群を PIVOT して 1 顧客 1 行に集約したもの）と `behavior_<元テーブル名>`（ビヘイビアのテーブルをエンリッチしたもの）もカタログの対象にする。それ以外の中間テーブルは載せず、リネージ上は Parent Segment にまとめる。

Parent Segment を TD コンソールの URL で指定された場合、URL の数値 ID から名前を推測しない（`tdx ps list` に ID が出ないため照合できない）。名前をユーザーに直接確認する。アカウントのデフォルト DB や文脈から類推しない。

起点から辿ったテーブルを **上流（Source・入力）と下流（出力・Parent Segment）に 1 ホップずつ** 広げて対象にする。対象テーブルが 50 を超えそうなら、一覧を見せて範囲を確認する。

### 5. テーブルのメタデータ

各テーブルについて `references/collection-playbook.md` の「スキーマとプロファイル」に従い:

1. スキーマ（information_schema または `tdx describe <db>.<table> --json`）
2. 行数と最終更新をクエリで取得する: `SELECT COUNT(*), MAX(time)`（`row_count` と `last_updated_unixtime`。`time` 列が無ければ行数のみ）。オーナーは取得しない
3. ID 候補・コード値候補カラムの軽量プロファイル（桁数・形式・NULL 率・値の種類）
4. マスク付きサンプル（含める場合のみ、10行。`LIMIT 10`）
5. 論理名・説明・利用用途を `references/metadata-rules.md` に従って作成

書き出しは `tables/<database>/<table>.json`（形式は `references/catalog-format.md`）。

### 6. ID体系の判定と問い合わせ（必須）

`references/metadata-rules.md` の「ID体系」に従い、ID らしいカラムを桁数・形式・値の重なりでグループ化する。次のどれかに当たるものは **必ずユーザーに問い合わせる**:

- 同じカラム名なのにテーブルによって桁数・形式が違う
- 名前が違うのに形式が同じで、値も重なる
- `id` / `user_id` / `customer_id` / `member_id` のような汎用名が複数テーブルにある
- 社内で複数の会員番号体系がありうる業種・構成（EC と店舗、旧システムと新システム など）

問い合わせは「グループ・形式・該当カラム・推定名」の表で示し、同一体系か・正式名称は何かを聞く。回答は `glossary.json` の `id_systems` に `status: confirmed` で記録し、カラムの `id_system` を付ける。回答が無いものは `needs_review` のまま残す。

### 7. リネージと ER

- リネージ: 手順 4 の結果から `lineage.json` を作る。ノード ID は `table:<db>.<table>` / `source:<id>` / `workflow:<project>.<workflow>` / `saved_query:<name>` / `parent_segment:<id>` / `activation:<id>` / `external:<id>`。テーブル中心に、Source → テーブル → Workflow/Saved Query → テーブル → `customers` / `behavior_*` → Parent Segment の向きで張る（Parent Segment の元テーブルは出力テーブルを経由させ、Parent Segment へ直接つながない）。`${...}` を解決できなかった参照は `confidence: unresolved`。
- ER（`relationships.json`）は **必ず作る**。0 件のまま次へ進まない。
  1. 候補を集める: Workflow / Saved Query の SQL の JOIN 条件（`ON a.x = b.y`）、Parent Segment 構成ファイルの結合キー（マスター ↔ 属性・ビヘイビアの元テーブル）、`behavior_*.cdp_customer_id → customers.cdp_customer_id`。
  2. ID体系からも候補を出す: `node $SKILL/scripts/catalog-cli.mjs relationships data-catalog/catalog`。同じ `id_system` のカラム同士の候補と、一致率を測る SQL が出力される（`--write` で `confidence: inferred` として追記）。
  3. 各候補の一致率 SQL を `tdx query` で実行し、`evidence` に一致率を書く。90% 以上かつ JOIN 定義があれば `confirmed`、50〜90% は `inferred`、50% 未満は登録しない（別体系の可能性としてユーザーに確認）。
  4. 書き方は `references/catalog-format.md` の形を厳守する: `{ "relationships": [ { "from": { "table": "<db>.<table>", "columns": ["<col>"] }, "to": { ... }, ... } ] }`。`table` は `tables/` に登録した `<db>.<table>` と完全一致させ、`columns` は配列にする。
  5. `validate` で relationships.json の warning（未登録テーブル・存在しないカラム・空）が無いことを確かめる。どうしても 0 件なら理由（ID 列が無い、権限が無いなど）を報告に書く。

### 8. サンプルクエリと処理事例

- 各テーブルに 2〜3 本の `sample_queries`（期間指定・代表的な集計・結合）を付ける。`time` 列があれば `td_interval` を使う。作ったクエリは `LIMIT 1` を付けて実行し、エラーが無いことを確かめてから載せる。
- 処理事例（`glossary.json` の `recipes`）: Workflow/Saved Query の SQL に出てくる集計式（`SUM(price * qty)`、`MAX(order_total)` など）、Parent Segment の集計ビヘイビア、ユーザーから聞いた用語から、**同じ指示がテーブルごとにどう計算されるか** を `variants` にまとめる。計算式の違い（税込/税抜、送料、キャンセル除外、明細とヘッダ）は `notes` / `conditions` に必ず書く。
- 作った用語・処理事例の一覧を見せて、ユーザーに確認・追加してもらう。

### 9. 顧客名・サービス名の確認

ここで初めて、顧客名・サービス名と、SKILL 名に使う英小文字のスラッグ（例: `acme` → `acme-data-catalog`）を確認する。`catalog.json` の `name` / `display_name` / `customer` / `service` を更新する。

### 10. 検証・リリース・出力

```bash
node $SKILL/scripts/catalog-cli.mjs validate data-catalog/catalog
node $SKILL/scripts/catalog-cli.mjs release  data-catalog/catalog --note "初版"
node $SKILL/scripts/catalog-cli.mjs pack     data-catalog/catalog --out data-catalog/<name>-data-catalog-r0001.zip
node $SKILL/scripts/catalog-cli.mjs skill    data-catalog/catalog --out <skills ディレクトリ> --zip data-catalog/<name>-data-catalog-skill.zip
```

- `validate` の error は必ず直す。warning は理由を確認し、残すなら報告する。
- skills ディレクトリは実行環境に合わせる（Treasure Work / Treasure AI Studio のユーザー SKILL は `~/.treasure-work/.claude/skills`、Claude Code は `~/.claude/skills`）。不明ならユーザーに聞く。
- 生成した `SKILL.md` の description が顧客の言葉（用語・DB名）で書かれていることを確認する。

### 11. 報告

次を短くまとめて返す。

- カタログ ZIP のパス（ビューアー https://tsukaharakazuki.github.io/treasure-ai-data-catalog/ で開ける）
- 生成した `<name>-data-catalog` SKILL の場所と配布用 ZIP
- 件数: テーブル / カラム / 論理名の確定率 / リネージ / リレーション / 用語 / 処理事例
- 要確認として残したもの（論理名、ID体系、unresolved なリネージ）と、次に誰に何を聞けばよいか

## 更新モード

1. 前回の ZIP を展開する: `node $SKILL/scripts/catalog-cli.mjs unpack <前回.zip> data-catalog/catalog`
2. `catalog.json` の `scope` に記録された対象で、手順 4〜8 を再実行する。以前の版で作ったカタログの `privacy.sample_rows_max` が 10 未満なら 10 に上げ、サンプルを 10 行で取り直す。
3. **人が確定した情報を消さない**:
   - `logical_name_status: confirmed` の論理名・説明・`id_system`・`values` は、カラムの型が変わっていない限り引き継ぐ
   - 用語・処理事例・業務ルール・ID体系はユーザーの指示なく削除しない
   - 消えたテーブル・カラムは削除してよい（差分に「削除」として残る）
4. `node $SKILL/scripts/catalog-cli.mjs diff data-catalog/catalog` で前回からの差分を見せ、内容をユーザーに確認する。
5. 確認が取れたら `release --note "<変更の要約>"` → `pack` → `skill` を実行し、新しいリビジョン番号で報告する。

## Parent Segment への反映モード

カタログで正規化した論理名を、Parent Segment の属性・ビヘイビアの表示名に設定してほしいと依頼されたときの手順。**TD への書き込みになるので、各段階でユーザーの承認を取る。** YAML の書き方は `tdx-skills:parent-segment` スキルを参照する。

1. `tdx ps pull "<name>" -o data-catalog/_work/ps/<name>.yml` で現在の設定を取得する（push 前の控えとして残す）。
2. カタログの論理名と現在の表示名を突き合わせ、変更案の表を作る（属性/ビヘイビア・元カラム・現在の表示名 → 新しい表示名・根拠）。`logical_name_status` が `confirmed` のものだけを候補にし、`inferred` / `needs_review` は先に確認してもらう。
3. **影響を調べる**: 表示名を参照している子セグメント・Journey・Activation が無いか確認する（`tdx sg pull` で子セグメントのルールを取得して名前を検索、`tdx journeys`）。参照があれば、変更で条件が壊れないかを表に添える。
4. 変更案と影響をユーザーに示し、適用する行を選んでもらう。
5. 承認された行だけ YAML を書き換え、`tdx ps validate` で検証してから `tdx ps push "<name>" --dry-run` で差分を見せる。
6. ユーザーが「適用してよい」と明示したら `tdx ps push "<name>"` を実行する。`-y` / `--yes` は付けない。**`tdx ps run` は実行しない**（再実行のタイミングはユーザーが決める）。
7. 反映後、カタログ側の該当カラムに「Parent Segment の表示名に反映済み」と記録し、更新モードと同じく `release --note "Parent Segment 表示名を反映"` する。

## 定期実行にする場合

ユーザーが定期更新を望んだら、Treasure Work のエージェント（`work-agent` スキル）として「更新モード」を実行するよう提案する。スケジュールは `draft` で作り、有効化はユーザーに任せる。
