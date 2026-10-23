import * as path from 'path'
import Handlebars from 'handlebars'

// Config files mise reads from each directory, relative to that directory (see
// DEFAULT_CONFIG_FILENAMES in mise). The cache key hashes these in the working
// directory and its parents, as mise finds them, rather than walking every
// subdirectory, which is slow once node_modules or vendor/bundle exist.
const MISE_CONFIG_FILE_PATTERNS = [
  `.config/mise/conf.d/*.toml`,
  `.config/mise/conf.d/*/mise*.toml`,
  `.config/mise/config.toml`,
  `.config/mise/config.lock`,
  `.config/mise/config.*.toml`,
  `.config/mise/config.*.lock`,
  `.config/mise/mise.toml`,
  `.config/mise/mise.*.toml`,
  `.config/mise/mise.lock`,
  `.config/mise/mise.*.lock`,
  `.config/mise.toml`,
  `.config/mise.lock`,
  `.config/mise.*.toml`,
  `.config/mise.*.lock`,
  `.mise/conf.d/*.toml`,
  `.mise/conf.d/*/mise*.toml`,
  `.mise/config.toml`,
  `.mise/config.lock`,
  `.mise/config.*.toml`,
  `.mise/config.*.lock`,
  `mise/conf.d/*.toml`,
  `mise/conf.d/*/mise*.toml`,
  `mise/config.toml`,
  `mise/config.lock`,
  `mise/config.*.toml`,
  `mise/config.*.lock`,
  `.mise.toml`,
  `.mise.lock`,
  `.mise.*.toml`,
  `.mise.*.lock`,
  `mise.toml`,
  `mise.lock`,
  `mise.*.toml`,
  `mise.*.lock`,
  `.tool-versions`
]

/** True when the template references `file_hash` or `default` (which embeds it). */
export function templateUsesFileHash(template: string): boolean {
  const walk = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(walk)
    if (node === null || typeof node !== 'object') return false
    const n = node as Record<string, unknown>
    // `parts` drops `this.` and `./`; a string literal could name it through a helper
    const names = ['file_hash', 'default']
    if (
      n.type === 'PathExpression' &&
      Array.isArray(n.parts) &&
      n.parts.some(part => names.includes(part as string))
    ) {
      return true
    }
    if (n.type === 'StringLiteral' && names.includes(n.value as string)) {
      return true
    }
    return Object.values(n).some(walk)
  }
  try {
    return walk(Handlebars.parseWithoutProcessing(template))
  } catch {
    return true
  }
}

/**
 * Globs for the config files mise would find from `cwd`: each pattern in `cwd`
 * and every parent up to the workspace, which is all `hashFiles` can see.
 */
export function configFileGlobs(cwd: string): string[] {
  const workspace = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd())
  const globs: string[] = []
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const rel = path.relative(workspace, dir)
    if (
      rel === '..' ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel)
    ) {
      break
    }
    const prefix = rel
      ? `${rel
          .split(path.sep)
          .join('/')
          .replace(/[*?[\]{}()!+@]/g, '[$&]')}/`
      : ''
    for (const pattern of MISE_CONFIG_FILE_PATTERNS) {
      globs.push(prefix + pattern)
    }
    if (dir === workspace) break
  }
  return globs
}
