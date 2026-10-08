export const REPO_URL = 'https://github.com/tsukaharakazuki/treasure-ai-data-catalog'

/** Short prompt copied from the landing page; the full procedure lives in the repository. */
export const STUDIO_PROMPT = `GitHubリポジトリ（${REPO_URL}）を読み込み、skills/treasure-ai-data-catalog-builder/SKILL.md の手順に従って、Treasure Data のデータカタログを作成してください。
1. どの情報（Parent Segment / Workflow / Saved Query / Source / データベース）をもとにカタログを作るか、私に確認してください。対象の名前や TD コンソールの URL は私が入力します。
2. tdx コマンドは読み取り専用で使い、wf run / push・ps run・journey resume などの実行・変更系コマンドは実行しないでください。
3. 論理名は日本語で付け、会員IDなど複数のID体系がありうるカラムは桁数・形式を確認したうえで私に問い合わせてください。
4. docs/CATALOG_FORMAT.md の形式でファイルを作り、scripts/catalog-cli.mjs で validate → release → pack して ZIP を返してください。
5. 最後に顧客名・サービス名を確認し、<name>-data-catalog SKILL を生成してください。
APIキー・認証情報は出力せず、サンプルデータの個人情報は必ずマスクしてください。`

export const UPDATE_PROMPT = `GitHubリポジトリ（${REPO_URL}）の skills/treasure-ai-data-catalog-builder/SKILL.md の「更新モード」に従い、添付したデータカタログ ZIP を最新の Treasure Data の状態に更新してください。
変更差分を確認してから release し、新しいリビジョンの ZIP と更新した <name>-data-catalog SKILL を返してください。実行・変更系の tdx コマンドは使わないでください。`
