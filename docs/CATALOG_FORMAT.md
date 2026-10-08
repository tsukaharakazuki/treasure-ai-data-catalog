# データカタログ形式

正本は builder SKILL に同梱している [`skills/treasure-ai-data-catalog-builder/references/catalog-format.md`](../skills/treasure-ai-data-catalog-builder/references/catalog-format.md) です。Treasure AI Studio が SKILL だけをコピーしても形式を参照できるよう、SKILL 側に置いています。

ビューアーの型定義は [`src/types/catalog.ts`](../src/types/catalog.ts)、検証ロジックは [`catalog-cli.mjs`](../skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs) の `lintBundle` です。形式を変えるときは 3 つをそろえて更新してください。
