---
name: treasure-ai-data-catalog-builder
description: "Treasure Data 環境のデータカタログを tdx の読み取り専用コマンドで作成・定期更新し、ビューアー（Treasure AI Data Catalog）で開ける ZIP と、誰でも使える <name>-data-catalog SKILL を生成する。メタデータ（スキーマ・利用者の言語での論理名・説明・利用用途・集計統計。実データの行サンプルは取得しない）、データリネージ（Source / Workflow / Saved Query / Parent Segment とテーブル）、ER図、テーブル別サンプルクエリ、リビジョン管理と差分、社内用語とテーブル別の処理事例集（「売上の合計」→ SUM(単価*個数) / MAX(注文合計金額) など）を扱う。Trigger on 「データカタログを作って」「データカタログを更新」「テーブル定義書を作りたい」「論理名を付けて」「リネージを可視化」「ER図を作って」「メタデータを整備」「<顧客名>-data-catalog を作って」「正規化した論理名をパーセグに反映して」「Parent Segment の表示名を直して」, data catalog, metadata catalog, data lineage, ER diagram for Treasure Data, or /treasure-ai-data-catalog-builder."
---

# Treasure AI Data Catalog Builder

Treasure Data の Parent Segment / Workflow / Saved Query / Source / データベースを起点にデータカタログを作り、ZIP と `<name>-data-catalog` SKILL を出力する。

- 形式の定義: `references/catalog-format.md`（必読。ファイル構成・フィールド・ノード ID 規約）
- tdx での収集手順とクエリ: `references/collection-playbook.md`
- 論理名・ID体系・行データを扱わない境界: `references/metadata-rules.md`
- CLI: `scripts/catalog-cli.mjs`（Node.js 24.22.1 以上の 24 LTS、または 26.12.1 以上の 26 LTS。依存なし。TD には接続しない）

以下、この SKILL のディレクトリを `$SKILL`、作業フォルダ（「my」以外の共有フォルダの中の `data-catalog`）を `$WORK` と書く。リポジトリから読んでいる場合、`$SKILL` は `skills/treasure-ai-data-catalog-builder` を指す。

## 絶対に守ること

1. **tdx は読み取り専用で使う**（唯一の例外は「Parent Segment への反映モード」での、ユーザー承認後の `tdx ps push`）。 `wf run` / `wf push` / `wf upload` / `wf delete` / `wf retry` / `wf attempt ... kill|retry` / `ps run` / `ps push` / `sg push` / `journey resume` / `job schedule run|create|update|delete` / `job submit` での書き込み、`CREATE` / `INSERT` / `DELETE` / `DROP` を含む SQL は実行しない。
2. **`tdx api` を自分で有効化しない。** 無効のままなら他の手段（Workflow の `td_load>` 設定、ユーザーへの質問）で補う。
3. **実データの行・値を取得しない。** 行サンプルは、マスク・ハッシュ化・部分伏字の有無や個人情報区分にかかわらず取得・保存・同梱しない。サンプルを含めるか質問しない。`tdx query` は行数・NULL率・長さ・種類数・一致率などの**集計値だけ**を返す SQL に限る。ID・コード値の実例、DISTINCT 値の一覧、個票、クエリ結果のダンプをチャット・ファイル・ログ・MEMORY.md・ZIP・生成 SKILL に出さず、それらから意味を推測しない（`references/metadata-rules.md`）。
4. **重いクエリを投げない。** `time` 列があるテーブルは必ず `td_interval(time, '-7d')` などで絞り、`approx_distinct` などの集計を使う。`LIMIT` は行データを返してよい理由にならない。フルスキャンになるプロファイリングは確認してから行う。
5. **推測を確定扱いしない。** 推定した論理名・リネージ・リレーションには `inferred` / `needs_review` を付ける。
6. API キー・トークン・Webhook URL・接続情報をファイルにもチャットにも出さない（MEMORY.md にも書かない）。
7. **生成物を「my」フォルダに置かない。** Treasure AI Studio の `my` フォルダは本人しかアクセスできず、他のメンバーに共有できない。カタログ・作業ファイル・ZIP・生成した SKILL・MEMORY.md は、必ず `my` 以外のフォルダを作成してその中に置く（下の「作業フォルダ」）。CLI も `my` の中への書き出しをエラーにする。
8. **作業を MEMORY.md に記録する。** 作業は段階を分けて、担当者をまたいで行われる。開始時に `$WORK/MEMORY.md` を読み、段階を終えるたび・中断するたびに時系列で追記する（下の「作業記録」）。

## 作業フォルダ（最初に必ず決める）

1. `pwd` で現在のフォルダを確認する。パスに `my` という名前のフォルダが含まれていたら、その中では作業しない。
2. `my` 以外のフォルダに作業フォルダを作る。既定は `my` と同じ階層（ワークスペース直下）の共有フォルダに `data-catalog/` を作り、`$WORK` とする。チームで使う共有フォルダの名前や置き場所の決まりがあればユーザーに確認して従う。
   ```bash
   pwd                                   # 例: /workspace/my → my の中なので使わない
   mkdir -p /workspace/data-catalog      # my 以外に作る（例）
   WORK=/workspace/data-catalog
   ```
3. 以降のファイルはすべて `$WORK` の下に置く。

```text
$WORK/                            ← my 以外の共有フォルダ
├─ MEMORY.md                      ← 作業記録（時系列・担当者をまたいで引き継ぐ）
├─ catalog/                       ← カタログ本体（ZIP に入る）
├─ _work/                         ← pull した Workflow など（ZIP に入れない。行データ・クエリ結果の個票は置かない）
├─ skills/<name>-data-catalog/    ← 生成した SKILL
├─ <name>-data-catalog-r000N.zip  ← ビューアーで開く ZIP（MEMORY.md も同梱される）
└─ <name>-data-catalog-skill.zip  ← 配布用 SKILL
```

ユーザーが添付したファイルや前回の ZIP が `my` にある場合は、読み取るのは構わないが、展開先・出力先は `$WORK` にする。

## 作業記録（MEMORY.md）

- **作業を始めたら最初に** `$WORK/MEMORY.md` を読む（前回の ZIP を展開した場合は ZIP 内の記録が復元される）。最後のエントリの「未解決・要確認」「次にやること」から再開し、ユーザーに現在の状態を一言で伝える。同じヒアリングを繰り返さない。
- 次のタイミングで追記する。追記は古い順（下に足す）。過去のエントリは書き換えず、訂正は新しいエントリで行う。
  - 各手順（ヒアリング・接続先の確認・収集・ID体系・リネージ/ER・サンプルクエリ/処理事例・命名・出力）を終えたとき
  - ユーザーの回答で何かが確定したとき（ID体系、用語の定義、顧客名 など）
  - 途中で止める・ユーザーの回答待ちになるとき
- 追記には CLI を使う（書式がそろう。担当者はユーザーの名前を聞いて入れる。分からなければ「Treasure AI Studio（<ユーザー名>）」など）:
  ```bash
  node $SKILL/scripts/catalog-cli.mjs memory $WORK/catalog --by "<担当者>" --stage "<段階>" --status 進行中 \
    --summary "<1行の要約>" \
    --done $'<実施したこと>\n<実施したこと>' \
    --decided $'<決定・確認済み>' \
    --open $'<未解決・要確認（誰に聞くか）>' \
    --next $'<次にやること>'
  ```
  `init` / `release` / `pack` / `unpack` / `skill` は自動で 1 行追記する（`--by` で担当者を付ける）。
- 書くのは判断の材料（対象・範囲、確定した事項とその根拠、要確認事項と確認先、次の手順）。実データの値・行（マスク済みを含む）、API キー、SQL の結果の個票は書かない。

## モードの判定

- 前回のカタログ ZIP が添付された、または「更新」と言われた → **更新モード**（末尾）
- カタログで正規化した論理名を Parent Segment の設定（属性・ビヘイビアの表示名）に反映してほしいと言われた → **Parent Segment への反映モード**（末尾）
- それ以外 → **新規作成**

## 新規作成の手順

### 1. ヒアリング（1回のメッセージでまとめて聞く）

先に「作業フォルダ」を決め、`$WORK/MEMORY.md` があれば読んでおく（既に回答済みの項目は聞き直さない）。次を質問する。選択肢があるものは選択肢で示す。

1. **カタログの起点**（複数選択可）: Parent Segment（Audience Studio）/ Workflow プロジェクト / Saved Query / Source（データコネクタ取込）/ データベース指定
2. **対象の名前、または TD コンソールの URL**（複数可）。例: Parent Segment 名、Workflow プロジェクト名、`https://console.treasuredata.com/...` の URL。**Parent Segment は URL だけでは特定できないので、名前も一緒に聞く**
3. **論理名・説明の言語**: 既定はユーザーの言語（日本語なら `ja`）
4. **社内用語や、よく出る集計指示**があれば（例: 「売上」「購入者数」「アクティブ会員」の定義）。コード値・ID 体系の仕様書があれば共有を依頼する。後でも構わないと伝える
5. **担当者名**（MEMORY.md に記録する。引き継ぎ相手が分かるようにするため）。作業フォルダの置き場所に決まりがあれば一緒に聞く

顧客名・サービス名は **手順 9 で** 聞く（情報が出揃ってから決める）。

### 2. 接続先の確認

`tdx status` でプロファイル・サイト・アカウントを確認し、ユーザーに提示する。URL のドメインと site が食い違う（例: `console.treasuredata.co.jp` なのに us01）場合は、`--site` / `--profile` の指定をユーザーに確認する。

### 3. 作業ディレクトリの初期化

```bash
node $SKILL/scripts/catalog-cli.mjs init $WORK/catalog --name draft --lang ja --site <site> --by "<担当者>"
```

`catalog.json` の `scope` に、手順 1 で受けた対象と URL（`scope.inputs`）を記録する。ヒアリングの回答と接続先を `memory --stage ヒアリング` で MEMORY.md に記録する。

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
2. 行数と最終更新をクエリで取得する: `SELECT COUNT(*), MAX(time)`（結果は **数値のまま** `row_count` と `last_updated_unixtime` に入れる。キー名を変えない・文字列にしない。`time` 列が無ければ行数のみ）。オーナーは取得しない。validate がこの 2 つの欠けを warning にするので、残さない
3. ID 候補・コード候補カラムの集計のみのプロファイル（NULL 率・長さの最小/最大・おおよその種類数・一意性）。値・値の形・DISTINCT 値の一覧は返さない。コード値の意味は仕様書・Workflow の定義・ユーザーの回答から書く
4. 論理名・説明・利用用途を `references/metadata-rules.md` に従って作成

テーブル JSON に `samples` を作らない（旧形式のフィールドで、validate がエラーにする）。

書き出しは `tables/<database>/<table>.json`（形式は `references/catalog-format.md`）。

### 6. ID体系の判定と問い合わせ（必須）

`references/metadata-rules.md` の「ID体系」に従い、ID らしいカラムを名前・型・定義・長さの集計・一致率（集計値のみ）でグループ化する。値の実例は使わない。次のどれかに当たるものは **必ずユーザーに問い合わせる**:

- 同じカラム名なのにテーブルによって桁数・形式が違う
- 名前が違うのに形式が同じで、値も重なる
- `id` / `user_id` / `customer_id` / `member_id` のような汎用名が複数テーブルにある
- 社内で複数の会員番号体系がありうる業種・構成（EC と店舗、旧システムと新システム など）

問い合わせは「グループ・根拠（名前・型・長さの範囲・一致率）・該当カラム・推定名」の表で示し、値の実例を載せずに、同一体系か・正式名称は何かを聞く。回答は `glossary.json` の `id_systems` に `status: confirmed` で記録し、カラムの `id_system` を付ける。回答が無いものは `needs_review` のまま残す。

### 7. リネージと ER

- リネージ: 手順 4 の結果から `lineage.json` を作る。ノード ID は `table:<db>.<table>` / `source:<id>` / `workflow:<project>.<workflow>` / `saved_query:<name>` / `parent_segment:<id>` / `activation:<id>` / `external:<id>`。テーブル中心に、Source → テーブル → Workflow/Saved Query → テーブル → `customers` / `behavior_*` → Parent Segment の向きで張る（Parent Segment の元テーブルは出力テーブルを経由させ、Parent Segment へ直接つながない）。`${...}` を解決できなかった参照は `confidence: unresolved`。
- ER（`relationships.json`）は **必ず作る**。0 件のまま次へ進まない。
  1. 候補を集める: Workflow / Saved Query の SQL の JOIN 条件（`ON a.x = b.y`）、Parent Segment 構成ファイルの結合キー（マスター ↔ 属性・ビヘイビアの元テーブル）、`behavior_*.cdp_customer_id → customers.cdp_customer_id`。
  2. ID体系からも候補を出す: `node $SKILL/scripts/catalog-cli.mjs relationships $WORK/catalog`。同じ `id_system` のカラム同士の候補と、一致率を測る SQL が出力される（`--write` で `confidence: inferred` として追記）。
  3. 各候補の一致率 SQL（件数と一致率だけを返すもの。キーの値は返さない）を `tdx query` で実行し、`evidence` に一致率を書く。90% 以上かつ JOIN 定義があれば `confirmed`、50〜90% は `inferred`、50% 未満は登録しない（別体系の可能性としてユーザーに確認）。
  4. 書き方は `references/catalog-format.md` の形を厳守する: `{ "relationships": [ { "from": { "table": "<db>.<table>", "columns": ["<col>"] }, "to": { ... }, ... } ] }`。`table` は `tables/` に登録した `<db>.<table>` と完全一致させ、`columns` は配列にする。
  5. `validate` で relationships.json の warning（未登録テーブル・存在しないカラム・空）が無いことを確かめる。どうしても 0 件なら理由（ID 列が無い、権限が無いなど）を報告に書く。

### 8. サンプルクエリと処理事例

- 各テーブルに 2〜3 本の `sample_queries`（期間指定・代表的な集計・結合）を付ける。`time` 列があれば `td_interval` を使う。`sample_queries` は SQL の例で、実行結果は載せない。行サンプルを取得するために実行しない（`LIMIT 1` 付きでも実行しない）。テーブル・カラム名、型、JOIN キーをカタログのスキーマと突き合わせて確認する。
- 処理事例（`glossary.json` の `recipes`）: Workflow/Saved Query の SQL に出てくる集計式（`SUM(price * qty)`、`MAX(order_total)` など）、Parent Segment の集計ビヘイビア、ユーザーから聞いた用語から、**同じ指示がテーブルごとにどう計算されるか** を `variants` にまとめる。計算式の違い（税込/税抜、送料、キャンセル除外、明細とヘッダ）は `notes` / `conditions` に必ず書く。
- 作った用語・処理事例の一覧を見せて、ユーザーに確認・追加してもらう。

### 9. 顧客名・サービス名の確認

ここで初めて、顧客名・サービス名と、SKILL 名に使う英小文字のスラッグ（例: `acme` → `acme-data-catalog`）を確認する。`catalog.json` の `name` / `display_name` / `customer` / `service` を更新する。

### 10. 検証・リリース・出力

```bash
node $SKILL/scripts/catalog-cli.mjs validate $WORK/catalog
node $SKILL/scripts/catalog-cli.mjs release  $WORK/catalog --note "初版" --by "<担当者>"
node $SKILL/scripts/catalog-cli.mjs pack     $WORK/catalog --out $WORK/<name>-data-catalog-r0001.zip --by "<担当者>"
node $SKILL/scripts/catalog-cli.mjs skill    $WORK/catalog --out $WORK/skills --zip $WORK/<name>-data-catalog-skill.zip --by "<担当者>"
```

- `validate` の error は必ず直す。warning は理由を確認し、残すなら報告する。カタログが `my` の中にあると error になる。非 null の `samples`（現在のテーブル・リビジョンのスナップショット）も error。
- `release` / `pack` / `skill` は検証エラーがあると出力しない。`--force` でも回避できないので、`--force` で通そうとしない。`skill` の出力先には新しい空のディレクトリを使う。
- 生成した SKILL と ZIP は `$WORK`（共有フォルダ）に出す。各自の SKILL ディレクトリ（Treasure Work / Treasure AI Studio は `~/.treasure-work/.claude/skills`、Claude Code は `~/.claude/skills`）へのインストールは、`$WORK/skills/<name>-data-catalog` をコピーして利用者ごとに行う。ユーザーに頼まれたら、そのユーザーの分だけコピーする。
- 出力が終わったら `memory --stage 出力 --status 完了` で、件数と要確認として残したものを記録する。
- 生成した `SKILL.md` の description が顧客の言葉（用語・DB名）で書かれていることを確認する。

### 11. 報告

次を短くまとめて返す。

- 作業フォルダ `$WORK`（my 以外の共有フォルダ）の場所
- カタログ ZIP のパス（ビューアー https://tsukaharakazuki.github.io/treasure-ai-data-catalog/ で開ける）
- 生成した `<name>-data-catalog` SKILL の場所と配布用 ZIP
- 件数: テーブル / カラム / 論理名の確定率 / リネージ / リレーション / 用語 / 処理事例
- 要確認として残したもの（論理名、ID体系、unresolved なリネージ）と、次に誰に何を聞けばよいか（MEMORY.md にも記録済みであること）

## 更新モード

1. 「作業フォルダ」を決め（`my` 以外）、前回の ZIP を展開する: `node $SKILL/scripts/catalog-cli.mjs unpack <前回.zip> $WORK/catalog --by "<担当者>"`。`unpack` は展開前に検査し、旧行サンプル（`samples`。過去のスナップショットを含む）がある ZIP や、既存ファイルを上書きする展開を拒否する。拒否されたら回避せず、元の保持者に旧サンプルと転記済みの行データを取り除いたカタログを用意してもらう。ビューアーが旧サンプルを表示しないことは、元の ZIP が安全になったことを意味しない。ZIP に同梱された作業記録が `$WORK/MEMORY.md` に復元されるので読み、前回の「未解決・要確認」「次にやること」から始める（既に `$WORK/MEMORY.md` がある場合、ZIP 側は `MEMORY.from-zip.md` に出るので、新しいエントリを時系列で MEMORY.md に統合する）。
2. `catalog.json` の `scope` に記録された対象で、手順 4〜8 を再実行する。行サンプルは取り直さない。`row_count` / `last_updated_unixtime` が無いテーブルは必ず取得して埋める。
3. **欠けを埋める**: `validate` の warning（`row_count` / `last_updated_unixtime` の欠け、規約外のノード id）をすべて解消する。リネージのノード id は `table:<db>.<table>` / `source:<id>` などの規約に直し、エッジの `from` / `to` も合わせて書き換える。
4. **人が確定した情報を消さない**:
   - `logical_name_status: confirmed` の論理名・説明・`id_system`・`values`（仕様・ユーザー確認に基づくコード定義）は、カラムの型が変わっていない限り引き継ぐ。ただし実データの値や行が転記されていれば引き継がず、削除して要確認にする
   - 用語・処理事例・業務ルール・ID体系はユーザーの指示なく削除しない
   - 消えたテーブル・カラムは削除してよい（差分に「削除」として残る）
5. `node $SKILL/scripts/catalog-cli.mjs diff $WORK/catalog` で前回からの差分を見せ、内容をユーザーに確認する。
6. 確認が取れたら `release --note "<変更の要約>"` → `pack` → `skill` を `$WORK` に向けて実行し、新しいリビジョン番号で報告する。各段階を MEMORY.md に記録する。

## Parent Segment への反映モード

カタログで正規化した論理名を、Parent Segment の属性・ビヘイビアの表示名に設定してほしいと依頼されたときの手順。**TD への書き込みになるので、各段階でユーザーの承認を取る。** YAML の書き方は `tdx-skills:parent-segment` スキルを参照する。

1. `tdx ps pull "<name>" -o $WORK/_work/ps/<name>.yml` で現在の設定を取得する（push 前の控えとして残す。`$WORK` は my 以外の共有フォルダ）。
2. カタログの論理名と現在の表示名を突き合わせ、変更案の表を作る（属性/ビヘイビア・元カラム・現在の表示名 → 新しい表示名・根拠）。`logical_name_status` が `confirmed` のものだけを候補にし、`inferred` / `needs_review` は先に確認してもらう。
3. **影響を調べる**: 表示名を参照している子セグメント・Journey・Activation が無いか確認する（`tdx sg pull` で子セグメントのルールを取得して名前を検索、`tdx journeys`）。参照があれば、変更で条件が壊れないかを表に添える。
4. 変更案と影響をユーザーに示し、適用する行を選んでもらう。
5. 承認された行だけ YAML を書き換え、`tdx ps validate` で検証してから `tdx ps push "<name>" --dry-run` で差分を見せる。
6. ユーザーが「適用してよい」と明示したら `tdx ps push "<name>"` を実行する。`-y` / `--yes` は付けない。**`tdx ps run` は実行しない**（再実行のタイミングはユーザーが決める）。
7. 反映後、カタログ側の該当カラムに「Parent Segment の表示名に反映済み」と記録し、更新モードと同じく `release --note "Parent Segment 表示名を反映"` する。承認者・承認日時・反映した行を MEMORY.md に `memory --stage "Parent Segment 反映"` で記録する。

## 定期実行にする場合

ユーザーが定期更新を望んだら、Treasure Work のエージェント（`work-agent` スキル）として「更新モード」を実行するよう提案する。スケジュールは `draft` で作り、有効化はユーザーに任せる。出力先は `my` 以外の共有フォルダにし、実行ごとに MEMORY.md に追記させる（担当者は「定期実行」）。
