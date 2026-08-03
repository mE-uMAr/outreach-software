/**
 * The single seam between the UI and its data.
 *
 * Every function here is async and shaped like the engine call that will replace
 * it. Swapping to the real backend means changing the body only — for example:
 *
 *     export async function listCampaigns(query: CampaignQuery): Promise<CampaignPage> {
 *       return engineCall<CampaignPage>('outreach.listCampaigns', query)
 *     }
 *
 * No component imports fixtures directly, so nothing else has to change.
 */

import { MOCK_AUTH, MOCK_CAMPAIGNS, MOCK_PROVIDERS, MOCK_SETTINGS, MOCK_STATS } from './fixtures.js'
import {
  progressOf,
  type AiProviderSummary,
  type Campaign,
  type CampaignPage,
  type CampaignQuery,
  type CampaignStats,
  type AnalysisStep,
  type AutomationSettings,
  type CampaignAnalysis,
  type ClaudeAuthStatus,
  type ConnectionTestResult
} from './types.js'

/** Simulated latency so loading states are exercised during development. */
const MOCK_LATENCY_MS = 260

function delay<T>(value: T, ms = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** In-memory copy so mutations survive within a session. */
let campaigns: Campaign[] = [...MOCK_CAMPAIGNS]

export async function getCampaignStats(): Promise<CampaignStats> {
  return delay(MOCK_STATS)
}

export async function listCampaigns(query: CampaignQuery = {}): Promise<CampaignPage> {
  const { search = '', status = 'all', sort = 'recent', page = 1, pageSize = 5 } = query

  let items = [...campaigns]

  if (status !== 'all') {
    items = items.filter((campaign) => campaign.status === status)
  }

  const term = search.trim().toLowerCase()
  if (term) {
    items = items.filter((campaign) => campaign.name.toLowerCase().includes(term))
  }

  items.sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'progress':
        return progressOf(b) - progressOf(a)
      case 'prospects':
        return b.targetProspects - a.targetProspects
      case 'recent':
      default:
        return b.createdAt.localeCompare(a.createdAt)
    }
  })

  const total = items.length
  const start = (page - 1) * pageSize

  return delay({ items: items.slice(start, start + pageSize), total, page, pageSize })
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  return delay(campaigns.find((campaign) => campaign.id === id) ?? null)
}

export async function setCampaignStatus(
  id: string,
  status: Campaign['status']
): Promise<Campaign | null> {
  campaigns = campaigns.map((campaign) =>
    campaign.id === id ? { ...campaign, status } : campaign
  )
  return getCampaign(id)
}

export async function deleteCampaign(id: string): Promise<{ deleted: boolean }> {
  const before = campaigns.length
  campaigns = campaigns.filter((campaign) => campaign.id !== id)
  return delay({ deleted: campaigns.length < before })
}

export async function createCampaign(
  draft: Omit<Campaign, 'id' | 'connectionsSent' | 'status' | 'createdAt'>
): Promise<Campaign> {
  const campaign: Campaign = {
    ...draft,
    id: `cmp_${Math.random().toString(36).slice(2, 10)}`,
    connectionsSent: 0,
    status: 'draft',
    createdAt: new Date().toISOString()
  }
  campaigns = [campaign, ...campaigns]
  return delay(campaign)
}

export async function listAiProviders(): Promise<AiProviderSummary[]> {
  return delay(MOCK_PROVIDERS)
}

/* ------------------------------------------------------------------ sign-in */

let authState: ClaudeAuthStatus = { ...MOCK_AUTH }

/** Mock of `ai.authStatus`. */
export async function getAuthStatus(): Promise<ClaudeAuthStatus> {
  return delay({ ...authState })
}

/**
 * Mock of `ai.login`. The real call streams `ai.login.url` first, so the
 * callback mirrors that ordering.
 */
export async function signInToClaude(
  onUrl?: (url: string) => void
): Promise<ClaudeAuthStatus> {
  await new Promise((resolve) => setTimeout(resolve, 600))
  onUrl?.('https://claude.ai/oauth/authorize?mock=1')
  await new Promise((resolve) => setTimeout(resolve, 1800))

  authState = {
    ...authState,
    loggedIn: true,
    email: 'you@example.com',
    organization: 'Your Organization',
    plan: 'pro'
  }
  return { ...authState }
}

/** Mock of `ai.logout` — clears the app session only. */
export async function signOutOfClaude(): Promise<ClaudeAuthStatus> {
  authState = { ...MOCK_AUTH }
  return delay({ ...authState }, 400)
}

/** Mock of `ai.testConnection`. */
export async function testAiConnection(
  provider: string,
  model?: string
): Promise<ConnectionTestResult> {
  await new Promise((resolve) => setTimeout(resolve, 900))

  if (provider === 'claude' && !authState.loggedIn) {
    return { ok: false, provider, error: 'Not signed in to Claude' }
  }
  return {
    ok: true,
    provider,
    model: model || (provider === 'claude' ? 'claude-sonnet-4-5' : 'echo-1'),
    latencyMs: 780,
    reply: 'ok'
  }
}

export async function getSettings(): Promise<AutomationSettings> {
  // Deep copy so edits in the UI do not mutate the fixture in place.
  return delay(structuredClone(MOCK_SETTINGS))
}

export async function saveSettings(settings: AutomationSettings): Promise<AutomationSettings> {
  return delay(structuredClone(settings), 500)
}

/* -------------------------------------------------- campaign creation flow */

const ANALYSIS_STEPS: AnalysisStep[] = [
  { label: 'Understanding search filters…', progress: 0.18 },
  { label: 'Counting matching prospects…', progress: 0.42 },
  { label: 'Checking for duplicates…', progress: 0.63 },
  { label: 'Applying your daily limits…', progress: 0.82 },
  { label: 'Preparing campaign plan…', progress: 1 }
]

/** A Sales Navigator search URL is the only accepted input. */
export function isSalesNavigatorUrl(value: string): boolean {
  return /^https?:\/\/(www\.)?linkedin\.com\/sales\/search\//i.test(value.trim())
}

/**
 * Mock of `outreach.analyzeSalesNavigatorUrl`. Reports progress through the
 * callback the same way the engine will push `engine.progress` notifications,
 * so the modal will not change when this is swapped for a real call.
 */
export async function analyzeSalesNavigatorUrl(
  url: string,
  onProgress?: (step: AnalysisStep) => void
): Promise<CampaignAnalysis> {
  for (const step of ANALYSIS_STEPS) {
    await new Promise((resolve) => setTimeout(resolve, 1400))
    onProgress?.(step)
  }

  const targetProspects = 500
  const dailyConnections = 20
  const estimatedDurationDays = Math.ceil(targetProspects / dailyConnections)
  const completion = new Date()
  // Working days only — weekends are skipped by the scheduler.
  completion.setDate(completion.getDate() + Math.ceil((estimatedDurationDays / 5) * 7))
  const expectedCompletion = completion.toISOString().slice(0, 10)

  return {
    suggestedName: nameFromUrl(url),
    targetProspects,
    estimatedDurationDays,
    dailyConnections,
    expectedCompletion,
    recommendations: [
      `${targetProspects} unique prospects detected`,
      'Daily outreach follows safe LinkedIn limits',
      `Estimated completion in ${estimatedDurationDays} working days`,
      'No duplicate prospects found',
      'Campaign ready to launch'
    ],
    rationale: {
      prospects: targetProspects,
      dailyLimit: dailyConnections,
      completionDate: expectedCompletion
    }
  }
}

/** Derive a readable campaign name from the search keywords in the URL. */
function nameFromUrl(url: string): string {
  try {
    const keywords = new URL(url).searchParams.get('keywords')
    if (keywords) {
      return keywords
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }
  } catch {
    /* fall through to the default below */
  }
  return 'Dubai CEOs'
}
