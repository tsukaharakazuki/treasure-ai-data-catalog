#!/usr/bin/env node
// Repository entry point. The canonical CLI ships inside the builder skill so the
// skill folder stays self-contained when it is copied into Treasure AI Studio.
import { main } from '../skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs'

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(`エラー: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
