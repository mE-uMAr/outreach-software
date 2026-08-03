/**
 * Domain types for the UI.
 *
 * These mirror what the engine's `outreach.*` methods will return, so swapping
 * the mock layer for real RPC calls is a change of implementation only.
 */

export type CampaignStatus = 'running' | 'paused' | 'analyzing' | 'draft' | 'completed'

export type CampaignSource = 'sales-navigator' | 'search' | 'csv-import'

export interface Campaign {
  id: string
  name: string
  source: CampaignSource
  status: CampaignStatus
  targetProspects: number
  dailyTarget: number
  /** True when the daily target is planned by the AI pacing engine. */
  autoPlanned: boolean
  connectionsSent: number
  /** ISO date, or null while the campaign has not been scheduled. */
  startDate: string | null
  estimatedEndDate: string | null
  /** ISO timestamp; drives the default "Recently Created" ordering. */
  createdAt: string
}

export interface CampaignStats {
  totalCampaigns: number
  activeCampaigns: number
  completedCampaigns: number
  totalProspects: number
  connectionsSentToday: number
  pendingFollowUps: number
  deltas: {
    totalCampaigns: string
    activeCampaigns: string
    completedCampaigns: string
    totalProspects: string
    connectionsSentToday: string
    pendingFollowUps: string
  }
}

export type CampaignSort = 'recent' | 'name' | 'progress' | 'prospects'

export interface CampaignQuery {
  search?: string
  status?: CampaignStatus | 'all'
  sort?: CampaignSort
  page?: number
  pageSize?: number
}

export interface CampaignPage {
  items: Campaign[]
  total: number
  page: number
  pageSize: number
}

export interface AiProviderSummary {
  name: string
  label: string
  defaultModel: string
  available: boolean
  unavailableReason: string | null
}

export interface OutreachSettings {
  defaultProvider: string
  defaultModel: string
  dailyConnectionLimit: number
  workingHoursStart: string
  workingHoursEnd: string
  pauseOnWeekends: boolean
  autoPlanDailyTargets: boolean
}

/** Percentage of the target reached, clamped to 0–100. */
export function progressOf(campaign: Campaign): number {
  if (campaign.targetProspects <= 0) return 0
  const ratio = (campaign.connectionsSent / campaign.targetProspects) * 100
  return Math.max(0, Math.min(100, Math.round(ratio)))
}
