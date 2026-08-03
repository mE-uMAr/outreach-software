import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface EngineLaunchSpec {
  command: string
  args: string[]
  cwd: string
  /** 'frozen' = PyInstaller binary shipped with the app; 'source' = interpreter + engine/main.py */
  mode: 'frozen' | 'source'
}

export class EngineNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineNotFoundError'
  }
}

const isWindows = process.platform === 'win32'
const EXE_NAME = isWindows ? 'linkedin-outreach-engine.exe' : 'linkedin-outreach-engine'

/** Where the frozen engine lives inside a packaged app. */
export function frozenEnginePath(): string {
  return join(process.resourcesPath, 'engine', EXE_NAME)
}

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
 * A packaged build runs the frozen binary and nothing else. It deliberately does
 * not fall back to a system interpreter: the installed app is meant to be
 * self-contained, and a machine with no Python would otherwise fail with a
 * confusing "python not found" instead of the real problem — a broken package.
 */
export function resolveEngineLaunchSpec(): EngineLaunchSpec {
  if (app.isPackaged) {
    const frozen = frozenEnginePath()
    if (!existsSync(frozen)) {
      throw new EngineNotFoundError(
        `The bundled engine is missing (expected at ${frozen}). This install is incomplete — reinstall the app.`
      )
    }
    return {
      command: frozen,
      args: [],
      cwd: join(process.resourcesPath, 'engine'),
      mode: 'frozen'
    }
  }

  const projectRoot = app.getAppPath()
  const entry = join(projectRoot, 'engine', 'main.py')

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
