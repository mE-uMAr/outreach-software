/**
 * The data layer.
 *
 * Every function here is a real call to the Python engine — there is no mock
 * path and no fixture data anywhere in the renderer. Anything the UI shows came
 * out of SQLite, out of a live browser session, or out of Claude.
 *
 * Long-running calls (sign-in, search analysis) take a callback and are given
 * their progress through engine notifications while they run.
 */

import { call, callWithEvents } from './engine.js'
import type {
  AiProviderSummary,
  AnalysisStep,
  AutomationSettings,
  Campaign,
  CampaignAnalysis,
  CampaignPage,
  CampaignQuery,
  CampaignStats,
  ClaudeAuthStatus,
  ConnectionTestResult,
  BrowserRuntimeStatus,
  LinkedInAccount,
  LinkedInStatus,
  Prospect,
  Readiness,
  UsageSummary
} from './types.js'

/** Sign-in waits on a person, so it gets its own generous ceiling. */
const LOGIN_TIMEOUT_MS = 11 * 60 * 1000
/** Analysis drives a real browser through a real search. */
const ANALYSIS_TIMEOUT_MS = 4 * 60 * 1000

/* ---------------------------------------------------------------- readiness */

/** What is connected and what still has to be, before the app can be used. */
export async function getReadiness(): Promise<Readiness> {
  return call<Readiness>('outreach.readiness', undefined, 45_000)
}

/* -------------------------------------------------------------- Claude auth */

export async function getAuthStatus(): Promise<ClaudeAuthStatus> {
  return call<ClaudeAuthStatus>('ai.authStatus', undefined, 45_000)
}

/**
 * Start the real Claude sign-in. The authorisation link arrives as a
 * notification before the call resolves, so it can be opened while the CLI is
 * still waiting for the callback.
 */
export async function signInToClaude(
  onUrl?: (url: string) => void,
  onOutput?: (line: string) => void
): Promise<ClaudeAuthStatus> {
  return callWithEvents<ClaudeAuthStatus>(
    'ai.login',
    undefined,
    'ai.login',
    (event) => {
      const params = event.params as { url?: string; line?: string }
      if (event.method === 'ai.login.url' && params.url) onUrl?.(params.url)
      if (event.method === 'ai.login.output' && params.line) onOutput?.(params.line)
    },
    LOGIN_TIMEOUT_MS
  )
}

export async function cancelClaudeSignIn(): Promise<void> {
  await call('ai.cancelLogin')
}

export async function signOutOfClaude(): Promise<ClaudeAuthStatus> {
  return call<ClaudeAuthStatus>('ai.logout', undefined, 60_000)
}

export async function testAiConnection(
  provider: string,
  model?: string
): Promise<ConnectionTestResult> {
  return call<ConnectionTestResult>('ai.testConnection', { provider, model }, 120_000)
}

export async function listAiProviders(): Promise<AiProviderSummary[]> {
  return call<AiProviderSummary[]>('ai.listProviders')
}

/* ------------------------------------------------------------ LinkedIn auth */

export async function getLinkedInStatus(deep = false): Promise<LinkedInStatus> {
  return call<LinkedInStatus>('linkedin.status', { deep }, 60_000)
}

/**
 * Open a browser window for the user to sign in to LinkedIn themselves.
 *
 * Nothing is typed into this app: the window is LinkedIn's own login page, and
 * the callback reports what the engine sees while it waits.
 */
export async function signInToLinkedIn(
  onStatus?: (message: string) => void
): Promise<LinkedInStatus> {
  return callWithEvents<LinkedInStatus>(
    'linkedin.login',
    undefined,
    'linkedin.login',
    (event) => {
      const params = event.params as { message?: string }
      if (params?.message) onStatus?.(params.message)
    },
    LOGIN_TIMEOUT_MS
  )
}

export async function cancelLinkedInSignIn(): Promise<void> {
  await call('linkedin.cancelLogin')
}

export async function signOutOfLinkedIn(): Promise<LinkedInStatus> {
  return call<LinkedInStatus>('linkedin.logout', undefined, 60_000)
}

export async function getLinkedInAccount(): Promise<LinkedInAccount | null> {
  return call<LinkedInAccount | null>('linkedin.account')
}

/* ----------------------------------------------------------- browser runtime */

export async function getBrowserStatus(): Promise<BrowserRuntimeStatus> {
  return call<BrowserRuntimeStatus>('browser.status')
}

/** Download Chromium. Reports the installer's own output as it goes. */
export async function installBrowserRuntime(
  onProgress?: (line: string) => void
): Promise<BrowserRuntimeStatus> {
  return callWithEvents<BrowserRuntimeStatus>(
    'browser.install',
    undefined,
    'engine.progress',
    (event) => {
      const params = event.params as { message?: string }
      if (params?.message) onProgress?.(params.message)
    },
    15 * 60 * 1000
  )
}

/* ---------------------------------------------------------------- campaigns */

export async function getCampaignStats(): Promise<CampaignStats> {
  return call<CampaignStats>('outreach.stats')
}

export async function listCampaigns(query: CampaignQuery = {}): Promise<CampaignPage> {
  const { search = '', status = 'all', sort = 'recent', page = 1, pageSize = 5 } = query
  return call<CampaignPage>('outreach.listCampaigns', { search, status, sort, page, pageSize })
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  return call<Campaign | null>('outreach.getCampaign', { id })
}

export async function createCampaign(draft: {
  name: string
  source: Campaign['source']
  searchUrl?: string | null
  targetProspects: number
  dailyTarget: number
  autoPlanned: boolean
  estimatedEndDate: string | null
  analysis?: CampaignAnalysis | null
}): Promise<Campaign> {
  return call<Campaign>('outreach.createCampaign', draft)
}

export async function updateCampaign(
  id: string,
  changes: Partial<Pick<Campaign, 'name' | 'dailyTarget' | 'targetProspects' | 'autoPlanned'>>
): Promise<Campaign | null> {
  return call<Campaign | null>('outreach.updateCampaign', { id, changes })
}

export async function setCampaignStatus(
  id: string,
  status: Campaign['status']
): Promise<Campaign | null> {
  return call<Campaign | null>('outreach.setCampaignStatus', { id, status })
}

export async function deleteCampaign(id: string): Promise<{ deleted: boolean }> {
  return call<{ deleted: boolean }>('outreach.deleteCampaign', { id })
}

export async function duplicateCampaign(id: string): Promise<Campaign | null> {
  return call<Campaign | null>('outreach.duplicateCampaign', { id })
}

export async function listProspects(campaignId: string, limit = 100): Promise<Prospect[]> {
  return call<Prospect[]>('outreach.listProspects', { campaignId, limit })
}

/** Queue everyone the campaign's search returns. */
export async function importProspects(
  campaignId: string,
  searchUrl: string,
  pages = 4
): Promise<{ queued: number }> {
  return call<{ queued: number }>(
    'linkedin.importProspects',
    { campaign_id: campaignId, search_url: searchUrl, pages },
    5 * 60 * 1000
  )
}

/* ----------------------------------------------------------------- settings */

export async function getSettings(): Promise<AutomationSettings> {
  return call<AutomationSettings>('outreach.getSettings')
}

export async function saveSettings(settings: AutomationSettings): Promise<AutomationSettings> {
  return call<AutomationSettings>('outreach.saveSettings', { settings })
}

/* -------------------------------------------------- campaign creation flow */

/** Whether the engine recognises this as a search it can work with. */
export async function validateSearchUrl(
  url: string
): Promise<{ valid: boolean; source: string | null; message?: string }> {
  return call('outreach.validateSearchUrl', { url })
}

/** A quick client-side check so the field can react as the user types. */
export function looksLikeSearchUrl(value: string): boolean {
  const trimmed = value.trim()
  return (
    /^https?:\/\/(www\.)?linkedin\.com\/sales\/search\//i.test(trimmed) ||
    /^https?:\/\/(www\.)?linkedin\.com\/search\/results\/people/i.test(trimmed)
  )
}

/**
 * Open the search in a real browser session, read its actual size, and have
 * Claude plan the campaign from those numbers.
 *
 * Progress is streamed from the engine as it works, so the modal shows the step
 * that is genuinely happening rather than a scripted animation.
 */
export async function analyzeSearchUrl(
  url: string,
  onProgress?: (step: AnalysisStep) => void
): Promise<CampaignAnalysis> {
  return callWithEvents<CampaignAnalysis>(
    'outreach.analyzeSearch',
    { url },
    'engine.progress',
    (event) => {
      const params = event.params as { message?: string; percent?: number }
      if (params?.message) {
        onProgress?.({ label: params.message, progress: (params.percent ?? 0) / 100 })
      }
    },
    ANALYSIS_TIMEOUT_MS
  )
}

/* -------------------------------------------------------------- ai drafting */

/** Adapt one of the operator's templates to a specific prospect. */
export async function draftMessage(
  templateId: string,
  prospect: Partial<Prospect>,
  campaignId?: string
): Promise<{ message: string; characters: number }> {
  return call('outreach.draftMessage', { templateId, prospect, campaignId }, 120_000)
}

/* -------------------------------------------------------------------- usage */

/** What the AI has cost, and how much of the work the plan cache absorbed. */
export async function getUsage(days = 30): Promise<UsageSummary> {
  return call<UsageSummary>('outreach.usage', { days })
}
