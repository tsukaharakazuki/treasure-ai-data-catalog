/** Drop legacy row samples before metadata enters application state or storage. */
export function metadataOnly<T>(value: T): T {
  const clean = structuredClone(value)
  const pending: unknown[] = [clean]
  while (pending.length) {
    const item = pending.pop()
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (key === 'samples' || key === 'example_masked') delete record[key]
      else if (key === 'sample_rows_max') record[key] = 0
      else if (record[key] && typeof record[key] === 'object') pending.push(record[key])
    }
  }
  return clean
}
