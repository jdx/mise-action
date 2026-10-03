type ToolVersion = {
  version: string
  requested_version?: string
  install_path?: string
  source?: unknown
}

type ToolVersionOutputs = {
  /** Every active, installed version per tool, keyed by tool name. */
  versions: Record<string, ToolVersion[]>
  /** The first active version per tool, for tools with a usable output name. */
  outputs: Record<string, string>
}

// Outputs that already mean something else, and so can't be a tool's name.
const RESERVED_OUTPUTS = new Set(['cache-hit', 'versions'])
// Only names a workflow can reference as `steps.<id>.outputs.<name>`.
const OUTPUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** Turn `mise ls --json --current` output into action outputs. */
export function toolVersionOutputs(ls: unknown): ToolVersionOutputs {
  const result: ToolVersionOutputs = { versions: {}, outputs: {} }
  if (!ls || typeof ls !== 'object' || Array.isArray(ls)) return result

  for (const [tool, entries] of Object.entries(ls)) {
    if (!Array.isArray(entries)) continue
    const active: ToolVersion[] = []
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        entry.active === false ||
        entry.installed === false ||
        typeof entry.version !== 'string'
      ) {
        continue
      }
      active.push({
        version: entry.version,
        requested_version: entry.requested_version ?? undefined,
        install_path: entry.install_path ?? undefined,
        source: entry.source ?? undefined
      })
    }
    if (active.length === 0) continue
    result.versions[tool] = active
    if (OUTPUT_NAME.test(tool) && !RESERVED_OUTPUTS.has(tool)) {
      result.outputs[tool] = active[0].version
    }
  }
  return result
}
