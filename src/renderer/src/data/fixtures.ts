import type {
  AiProviderSummary,
  ClaudeAuthStatus,
  AutomationSettings,
  Campaign,
  CampaignStats
} from './types.js'

/** Static fixtures backing the mock API. Replaced wholesale by engine data. */

export const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: 'cmp_dubai_ceos',
    name: 'Dubai CEOs',
    source: 'sales-navigator',
    status: 'running',
    targetProspects: 500,
    dailyTarget: 20,
    autoPlanned: true,
    connectionsSent: 240,
    startDate: '2026-08-01',
    estimatedEndDate: '2026-08-26',
    createdAt: '2026-07-30T09:15:00Z'
  },
  {
    id: 'cmp_london_vcs',
    name: 'London VCs',
    source: 'sales-navigator',
    status: 'running',
    targetProspects: 320,
    dailyTarget: 15,
    autoPlanned: true,
    connectionsSent: 90,
    startDate: '2026-08-05',
    estimatedEndDate: '2026-08-27',
    createdAt: '2026-07-29T14:02:00Z'
  },
  {
    id: 'cmp_nyc_fintech',
    name: 'NYC Fintech Founders',
    source: 'sales-navigator',
    status: 'paused',
    targetProspects: 750,
    dailyTarget: 25,
    autoPlanned: true,
    connectionsSent: 310,
    startDate: '2026-07-15',
    estimatedEndDate: '2026-09-10',
    createdAt: '2026-07-28T11:40:00Z'
  },
  {
    id: 'cmp_singapore_saas',
    name: 'Singapore SaaS CTOs',
    source: 'sales-navigator',
    status: 'analyzing',
    targetProspects: 400,
    dailyTarget: 20,
    autoPlanned: true,
    connectionsSent: 0,
    startDate: null,
    estimatedEndDate: null,
    createdAt: '2026-07-27T16:20:00Z'
  },
  {
    id: 'cmp_berlin_b2b',
    name: 'Berlin B2B Leaders',
    source: 'sales-navigator',
    status: 'draft',
    targetProspects: 280,
    dailyTarget: 18,
    autoPlanned: true,
    connectionsSent: 0,
    startDate: null,
    estimatedEndDate: null,
    createdAt: '2026-07-26T08:05:00Z'
  },
  {
    id: 'cmp_toronto_growth',
    name: 'Toronto Growth Leads',
    source: 'search',
    status: 'completed',
    targetProspects: 260,
    dailyTarget: 12,
    autoPlanned: false,
    connectionsSent: 260,
    startDate: '2026-06-02',
    estimatedEndDate: '2026-07-14',
    createdAt: '2026-05-28T10:00:00Z'
  },
  {
    id: 'cmp_sydney_agency',
    name: 'Sydney Agency Owners',
    source: 'csv-import',
    status: 'running',
    targetProspects: 180,
    dailyTarget: 10,
    autoPlanned: false,
    connectionsSent: 64,
    startDate: '2026-07-28',
    estimatedEndDate: '2026-08-19',
    createdAt: '2026-05-20T13:30:00Z'
  }
]

export const MOCK_STATS: CampaignStats = {
  totalCampaigns: 24,
  activeCampaigns: 8,
  completedCampaigns: 12,
  totalProspects: 8420,
  connectionsSentToday: 156,
  pendingFollowUps: 43,
  deltas: {
    totalCampaigns: '+3 this month',
    activeCampaigns: '2 starting soon',
    completedCampaigns: '+1 this week',
    totalProspects: '+640 added',
    connectionsSentToday: '−4 vs yesterday',
    pendingFollowUps: '12 overdue'
  }
}

export const MOCK_PROVIDERS: AiProviderSummary[] = [
  {
    name: 'claude',
    label: 'Claude',
    defaultModel: 'default',
    available: true,
    requiresKey: false,
    unavailableReason: null
  },
  {
    name: 'echo',
    label: 'Echo (offline)',
    defaultModel: 'echo-1',
    available: true,
    requiresKey: false,
    unavailableReason: null
  }
]

export const MOCK_AUTH: ClaudeAuthStatus = {
  installed: true,
  loggedIn: false,
  email: null,
  organization: null,
  plan: null,
  sessionDir: '~/.config/linkedin-outreach/claude-session'
}

export const MOCK_SETTINGS: AutomationSettings = {
  ai: {
    provider: 'claude',
    model: ''
  },
  schedule: [
    { key: 'mon', short: 'Mon', full: 'Monday', enabled: true, action: 'send', dailyLimit: 20 },
    { key: 'tue', short: 'Tue', full: 'Tuesday', enabled: true, action: 'send', dailyLimit: 20 },
    { key: 'wed', short: 'Wed', full: 'Wednesday', enabled: true, action: 'send', dailyLimit: 20 },
    { key: 'thu', short: 'Thu', full: 'Thursday', enabled: true, action: 'send', dailyLimit: 20 },
    { key: 'fri', short: 'Fri', full: 'Friday', enabled: true, action: 'send', dailyLimit: 20 },
    { key: 'sat', short: 'Sat', full: 'Saturday', enabled: false, action: 'none', dailyLimit: 0 },
    { key: 'sun', short: 'Sun', full: 'Sunday', enabled: false, action: 'none', dailyLimit: 0 }
  ],
  limits: {
    connectionRequests: 20,
    postLikes: 30,
    postComments: 15
  },
  followUps: {
    secondFollowUpDays: 3,
    thirdFollowUpDays: 5,
    autoWithdrawPending: true
  },
  templates: [
    {
      id: 'connection-note',
      title: 'Connection Note',
      description: 'Sent with the connection request. Max 300 chars.',
      subject: '',
      body: '',
      maxChars: 300
    },
    {
      id: 'first-message',
      title: 'First Message After Acceptance',
      description: 'First message after they accept your connection.',
      subject: '',
      body: '',
      maxChars: 1000
    },
    {
      id: 'second-followup',
      title: 'Second Follow-up',
      description: 'Sent after no reply to the first message.',
      subject: '',
      body: '',
      maxChars: 1000
    },
    {
      id: 'third-followup',
      title: 'Third Follow-up',
      description: 'Final touch — sent if no reply to second follow-up.',
      subject: '',
      body: '',
      maxChars: 1000
    }
  ],
  sheets: {
    connected: true,
    name: 'LinkedIn Outreach Master Sheet',
    url: 'docs.google.com/spreadsheets/d/1aB…',
    lastSynced: '2 minutes ago',
    rowsSynced: 1247,
    autoSyncMinutes: 5
  }
}
