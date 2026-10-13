/** Build the arguments shared by `mise install` invocations. */
export function buildInstallCommand(
  installArgs: string,
  useLocked: boolean,
  useMonorepo: boolean
): string {
  const args = installArgs.trim()
  const hasLocked = /(^|\s)--locked(?:\s|$)/.test(args)
  const hasMonorepo = /(^|\s)--monorepo(?:\s|$)/.test(args)
  return [
    'install',
    ...(useLocked && !hasLocked ? ['--locked'] : []),
    ...(useMonorepo && !hasMonorepo ? ['--monorepo'] : []),
    ...(args ? [args] : [])
  ].join(' ')
}
