# Treasure AI Studio でデータカタログを作る

Treasure AI Studio（Treasure Work）にこのリポジトリを読ませると、`skills/treasure-ai-data-catalog-builder/SKILL.md` の手順でカタログを作ります。Studio は tdx を読み取り専用で使い、ZIP と `<name>-data-catalog` SKILL を返します。

## 1. 新規作成

次のプロンプトをそのまま貼り付けます（ビューアーのトップページからもコピーできます）。

```text
GitHubリポジトリ（https://github.com/tsukaharakazuki/treasure-ai-data-catalog）を読み込み、skills/treasure-ai-data-catalog-builder/SKILL.md の手順に従って、Treasure Data のデータカタログを作成してください。
1. どの情報（Parent Segment / Workflow / Saved Query / Source / データベース）をもとにカタログを作るか、私に確認してください。対象の名前や TD コンソールの URL は私が入力します。
2. tdx コマンドは読み取り専用で使い、wf run / push・ps run・journey resume などの実行・変更系コマンドは実行しないでください。
3. 論理名は日本語で付け、会員IDなど複数のID体系がありうるカラムは桁数・形式を確認したうえで私に問い合わせてください。
4. docs/CATALOG_FORMAT.md の形式でファイルを作り、scripts/catalog-cli.mjs で validate → release → pack して ZIP を返してください。
5. 最後に顧客名・サービス名を確認し、<name>-data-catalog SKILL を生成してください。
APIキー・認証情報は出力せず、サンプルデータの個人情報は必ずマスクしてください。
```

Studio は次の順に進めます。

| 段階 | Studio がすること | あなたが答えること |
| --- | --- | --- |
| ヒアリング | 起点・対象・サンプル有無・言語を質問 | Parent Segment 名 / Workflow プロジェクト名 / TD コンソール URL など |
| 収集 | `tdx ps` / `tdx wf pull` / `tdx job schedule` / `tdx describe` / 軽量な `tdx query` | 対象が多いときの範囲確認 |
| ID体系 | 会員ID などを桁数・形式・一致率でグループ化 | 同じ体系か、正式名称は何か |
| 用語・処理事例 | SQL の集計式から「指示 → テーブル別の計算」を下書き | 社内用語の定義、計算方法の確認 |
| 命名 | 顧客名・サービス名・スラッグを確認 | 例: `acme` → `acme-data-catalog` |
| 出力 | validate → release → pack → skill | — |

## 2. 定期更新

前回の ZIP を添付して、次のプロンプトを貼り付けます。

```text
GitHubリポジトリ（https://github.com/tsukaharakazuki/treasure-ai-data-catalog）の skills/treasure-ai-data-catalog-builder/SKILL.md の「更新モード」に従い、添付したデータカタログ ZIP を最新の Treasure Data の状態に更新してください。
変更差分を確認してから release し、新しいリビジョンの ZIP と更新した <name>-data-catalog SKILL を返してください。実行・変更系の tdx コマンドは使わないでください。
```

人が確定した論理名・ID体系・用語は引き継がれ、変更点は `CHANGELOG.md` とビューアーの「リビジョン」画面で確認できます。

## 3. 生成された SKILL を配る

`<name>-data-catalog-skill.zip` を展開し、各利用者の SKILL ディレクトリ（Treasure Work なら `~/.treasure-work/.claude/skills/`）に置きます。利用者は「売上の合計を出して」「会員IDはどのカラム？」「このテーブルはどこから来ている？」のように聞くだけで、カタログに沿ったテーブル選択と SQL が返ります。

## builder SKILL を Studio に入れて使う

リポジトリを毎回読ませる代わりに、`skills/treasure-ai-data-catalog-builder/` フォルダごと SKILL ディレクトリにコピーしておくと、「データカタログを作って」だけで起動します。

## 受け取った ZIP の確認ポイント

- ビューアーで開いて「概要」の警告が空であること
- 論理名の「要確認」が残っていれば、誰に確認するか
- サンプルデータの個人情報がマスクされていること（validate が検査済み）
- `run` / `push` 系のコマンドを一度も実行していないこと（Studio の実行ログで確認）
