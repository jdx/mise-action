type PluginSpec = {
  name: string
  url?: string
}

/**
 * Parse the `plugins` input: one plugin per line, either `name` or
 * `name url`. Blank lines and `#` comments are ignored.
 */
export function parsePlugins(input: string): PluginSpec[] {
  const plugins: PluginSpec[] = []
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*/, '').trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (parts.length > 2) {
      throw new Error(
        `Invalid plugins entry "${line}": expected "name" or "name url"`
      )
    }
    const [name, url] = parts
    if (name.startsWith('-') || (url !== undefined && url.startsWith('-'))) {
      throw new Error(`Invalid plugins entry "${line}"`)
    }
    plugins.push(url === undefined ? { name } : { name, url })
  }
  return plugins
}
