import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface EngineLaunchSpec {
  command: string
  args: string[]
  cwd: string
  /** 'frozen' = PyInstaller binary shipped in resources; 'source' = interpreter + engine/main.py */
  mode: 'frozen' | 'source'
}

const isWindows = process.platform === 'win32'
const EXE_NAME = isWindows ? 'linkedin-outreach-engine.exe' : 'linkedin-outreach-engine'

/**
 * Candidate interpreters for development, most specific first: a project-local
 * virtualenv beats whatever happens to be on PATH.
 */
function devInterpreters(projectRoot: string): string[] {
  const venvPython = isWindows
    ? join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : join(projectRoot, '.venv', 'bin', 'python')

  const candidates = [process.env.LINKEDIN_OUTREACH_PYTHON, venvPython].filter(
    (value): value is string => Boolean(value)
  )

  return [...candidates, isWindows ? 'python' : 'python3']
}

/**
 * Decide how to start the engine.
 *
 * Packaged builds always prefer the frozen binary under `resources/engine`; a
 * source fallback exists so a broken/missing freeze during local packaging tests
 * still yields a running app instead of a silent dead sidecar.
 */
export function resolveEngineLaunchSpec(): EngineLaunchSpec {
  const projectRoot = app.isPackaged ? process.resourcesPath : app.getAppPath()

  if (app.isPackaged) {
    const frozen = join(process.resourcesPath, 'engine', EXE_NAME)
    if (existsSync(frozen)) {
      return { command: frozen, args: [], cwd: join(process.resourcesPath, 'engine'), mode: 'frozen' }
    }
  }

  const entry = app.isPackaged
    ? join(process.resourcesPath, 'engine', 'main.py')
    : join(projectRoot, 'engine', 'main.py')

  // A bare name (`python3`) is left to PATH resolution; an explicit path must exist.
  const interpreter = devInterpreters(projectRoot).find((candidate) => {
    const isPath = candidate.includes('/') || candidate.includes('\\')
    return isPath ? existsSync(candidate) : true
  })

  return {
    command: interpreter ?? (isWindows ? 'python' : 'python3'),
    args: ['-u', entry],
    cwd: projectRoot,
    mode: 'source'
  }
}
