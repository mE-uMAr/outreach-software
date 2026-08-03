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
  requiresKey: boolean
  unavailableReason: string | null
}

/** Which model the app talks to, and the credential for it. */
export interface AiConnection {
  provider: string
  model: string
  apiKey: string
}

/* ----------------------------------------------------------------- settings */

export type AutomationAction = 'send' | 'followup' | 'none'

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface DaySchedule {
  key: DayKey
  /** Short label shown in the row, e.g. "Mon". */
  short: string
  /** Full weekday name shown underneath. */
  full: string
  enabled: boolean
  action: AutomationAction
  dailyLimit: number
}

export interface ActivityLimits {
  connectionRequests: number
  postLikes: number
  postComments: number
}

export interface FollowUpRules {
  secondFollowUpDays: number
  thirdFollowUpDays: number
  autoWithdrawPending: boolean
}

export type TemplateId =
  | 'connection-note'
  | 'first-message'
  | 'second-followup'
  | 'third-followup'

export interface MessageTemplate {
  id: TemplateId
  title: string
  description: string
  subject: string
  body: string
  /** Character budget; LinkedIn caps connection notes at 300. */
  maxChars: number
}

export interface SheetsIntegration {
  connected: boolean
  name: string
  url: string
  lastSynced: string
  rowsSynced: number
  autoSyncMinutes: number
}

export interface AutomationSettings {
  ai: AiConnection
  schedule: DaySchedule[]
  limits: ActivityLimits
  followUps: FollowUpRules
  templates: MessageTemplate[]
  sheets: SheetsIntegration
}

/** Days the automation actually runs. */
export function activeDays(schedule: DaySchedule[]): number {
  return schedule.filter((day) => day.enabled && day.action !== 'none').length
}

/** Sum of the daily limits across enabled days. */
export function weeklyTotal(schedule: DaySchedule[]): number {
  return schedule.reduce(
    (total, day) => (day.enabled && day.action !== 'none' ? total + day.dailyLimit : total),
    0
  )
}

/** A template counts as complete once it has a body. */
export function isTemplateComplete(template: MessageTemplate): boolean {
  return template.body.trim().length > 0
}

/** Percentage of the target reached, clamped to 0–100. */
export function progressOf(campaign: Campaign): number {
  if (campaign.targetProspects <= 0) return 0
  const ratio = (campaign.connectionsSent / campaign.targetProspects) * 100
  return Math.max(0, Math.min(100, Math.round(ratio)))
}

/* -------------------------------------------------- campaign creation flow */

/** One step of the AI analysis, streamed to the modal while it runs. */
export interface AnalysisStep {
  label: string
  /** Fraction of total work completed once this step finishes (0–1). */
  progress: number
}

export interface CampaignAnalysis {
  suggestedName: string
  targetProspects: number
  estimatedDurationDays: number
  dailyConnections: number
  expectedCompletion: string
  recommendations: string[]
  /** Plain-language summary of how the numbers were derived. */
  rationale: {
    prospects: number
    dailyLimit: number
    completionDate: string
  }
}
