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

import { MOCK_CAMPAIGNS, MOCK_PROVIDERS, MOCK_SETTINGS, MOCK_STATS } from './fixtures.js'
import {
  progressOf,
  type AiProviderSummary,
  type Campaign,
  type CampaignPage,
  type CampaignQuery,
  type CampaignStats,
  type OutreachSettings
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

export async function getSettings(): Promise<OutreachSettings> {
  return delay(MOCK_SETTINGS)
}

export async function saveSettings(patch: Partial<OutreachSettings>): Promise<OutreachSettings> {
  return delay({ ...MOCK_SETTINGS, ...patch })
}
