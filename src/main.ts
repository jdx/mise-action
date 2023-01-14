import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'

async function run(): Promise<void> {
  await setupRTX()
  await setToolVersions()
  await exec.exec('rtx', ['install'])
}

async function setupRTX(): Promise<void> {
  console.error("TODO: SETUPRTX");
}

async function setToolVersions(): Promise<void> {
  let toolVersions = core.getInput("tool_versions", { required: false });
  if (toolVersions) {
    await fs.promises.writeFile(".tool-versions", toolVersions, {
      encoding: "utf8",
    });
  }
}

if (require.main === module) {
  try {
    run()
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    } else throw err
  }
}

export { run }
