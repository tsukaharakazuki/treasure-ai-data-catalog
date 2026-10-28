# データカタログ形式

正本は builder SKILL に同梱している [`skills/treasure-ai-data-catalog-builder/references/catalog-format.md`](../skills/treasure-ai-data-catalog-builder/references/catalog-format.md) です。Treasure AI Studio が SKILL だけをコピーしても形式を参照できるよう、SKILL 側に置いています。

ビューアーの型定義は [`src/types/catalog.ts`](../src/types/catalog.ts)、検証ロジックは [`catalog-cli.mjs`](../skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs) の `lintBundle` です。形式を変えるときは 3 つをそろえて更新してください。

## 行データを含めない境界

- カタログには実データの行サンプルを含めません。マスク・ハッシュ化・部分伏字した行も同じです。
- 入れてよいのは、スキーマ、仕様書・ユーザー確認に基づく定義、関係・リネージ、SQL の例（`sample_queries`。実行結果ではない）、行数・NULL率・長さ・種類数・一致率などの集計値です。
- 旧形式の `samples` は禁止です。非 null の `samples` は現在のテーブルとリビジョンのスナップショットのどちらにあっても検証エラーになり、出力コマンドは `--force` 指定時も検証エラーを回避しません。`unpack` は旧行サンプルを含む ZIP を拒否し、ビューアーは読み込んだ旧サンプルを破棄して表示しません。
- これらの検査は補助的な防御です。ほかのフィールドへ転記された実データをすべて検出するものではないため、収集時に取得・記録しないことを前提にします。
