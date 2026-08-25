/**
 * Domain types for the UI.
 *
 * These mirror exactly what the engine's `outreach.*`, `linkedin.*` and
 * `browser.*` methods return. The engine speaks camelCase on the wire for this
 * reason — the row shapes in SQLite are snake_case and are translated once, in
 * the store layer, so nothing here has to know about the database.
 */

export type CampaignStatus = 'running' | 'paused' | 'analyzing' | 'draft' | 'completed'

export type CampaignSource = 'sales-navigator' | 'search' | 'csv-import'

export interface Campaign {
  id: string
  name: string
  source: CampaignSource
  status: CampaignStatus
  /** The search this campaign draws its prospects from. */
  searchUrl: string | null
  targetProspects: number
  dailyTarget: number
  /** True when the daily target came from the AI pacing plan. */
  autoPlanned: boolean
  connectionsSent: number
  /** ISO date, or null while the campaign has not been started. */
  startDate: string | null
  estimatedEndDate: string | null
  /** The plan the campaign was approved from, kept for the detail view. */
  analysis: CampaignAnalysis | null
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

/** A person queued against a campaign. */
export interface Prospect {
  id: string
  fullName: string
  headline: string | null
  company: string | null
  location: string | null
  profileUrl: string
  status: 'queued' | 'invited' | 'accepted' | 'replied' | 'skipped' | 'failed'
  invitedAt: string | null
  acceptedAt: string | null
  repliedAt: string | null
  followupsSent: number
  error: string | null
}

/* --------------------------------------------------------------- connections */

export interface AiProviderSummary {
  name: string
  label: string
  defaultModel: string
  available: boolean
  requiresApiKey: boolean
  unavailableReason: string | null
}

/** Which model the app talks to. No credential: sign-in is delegated to Claude. */
export interface AiConnection {
  provider: string
  model: string
}

/** Sign-in state of the app's own sandboxed Claude session. */
export interface ClaudeAuthStatus {
  installed: boolean
  loggedIn: boolean
  email: string | null
  organization: string | null
  plan: string | null
  authMethod?: string | null
  sessionDir: string
  error?: string
}

/** The connected LinkedIn identity. Never carries the session itself. */
export interface LinkedInAccount {
  id: string
  memberUrn: string | null
  publicId: string | null
  fullName: string
  headline: string
  email: string | null
  location: string | null
  avatarUrl: string | null
  profileUrl: string | null
  premium: boolean
  salesNavigator: boolean
  status: 'connected' | 'expired'
  lastVerifiedAt: string | null
  createdAt: string
}

export interface LinkedInStatus {
  connected: boolean
  account: LinkedInAccount | null
  checkedAt?: number
  verified?: boolean
  verifyError?: string
}

/** Whether Chromium is present. The app can be set up before it is. */
export interface BrowserRuntimeStatus {
  installed: boolean
  reason: string | null
  message: string | null
  chromiumPath?: string | null
  profileDir: string
  open?: boolean
}

/** Everything that must be connected before the app unlocks. */
export interface Readiness {
  ready: boolean
  ai: {
    ready: boolean
    installed: boolean
    email: string | null
    plan: string | null
    organization: string | null
    error?: string
  }
  linkedin: { ready: boolean; account: LinkedInAccount | null }
  browser: { ready: boolean; reason: string | null; message: string | null }
  blocking: string[]
}

export interface ConnectionTestResult {
  ok: boolean
  provider: string
  model?: string
  latencyMs?: number
  reply?: string
  error?: string
  usage?: { inputTokens: number; outputTokens: number; costUsd: number }
}

/** What the AI has cost, and how much of the work never reached a model. */
export interface UsageSummary {
  windowDays: number
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheHits: number
  cacheHitRate: number
  cachedPlans: number
  screenshotCalls: number
  screenshotRate: number
  avgDurationMs: number
  byPurpose: { purpose: string; calls: number; costUsd: number }[]
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

/** How the browser agent is allowed to spend time and money. */
export interface BrowserSettings {
  headless: boolean
  screenshotTier: 'never' | 'on-demand' | 'always'
  planCache: boolean
  maxStepsPerTask: number
  fastModel: string
  reasoningModel: string
}

export interface AutomationSettings {
  ai: AiConnection
  schedule: DaySchedule[]
  limits: ActivityLimits
  followUps: FollowUpRules
  templates: MessageTemplate[]
  sheets: SheetsIntegration
  browser: BrowserSettings
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

/** One step of the analysis, pushed from the engine while it runs. */
export interface AnalysisStep {
  label: string
  /** Fraction of total work completed once this step finishes (0–1). */
  progress: number
}

/** A prospect as it appears in the analysis preview, before being queued. */
export interface SampleProspect {
  fullName: string
  headline: string | null
  location: string | null
  profileUrl: string
}

export interface CampaignAnalysis {
  source: CampaignSource
  searchUrl: string
  suggestedName: string
  /** Prospects this campaign can actually reach. */
  targetProspects: number
  /** What LinkedIn reported matching, which can be far larger. */
  totalMatches: number
  estimatedDurationDays: number
  dailyConnections: number
  expectedCompletion: string
  recommendations: string[]
  sampleProspects: SampleProspect[]
  /** Plain-language account of how the numbers were derived. */
  rationale: {
    prospects: number
    dailyLimit: number
    completionDate: string
    explanation: string
  }
}
