import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Check,
  Send,
  Sparkles,
  Target,
  TriangleAlert,
  Users,
  type LucideIcon
} from 'lucide-react'
import { Modal } from '../ui/Modal.js'
import { Button } from '../ui/Button.js'
import { AnalysisOrb } from './AnalysisOrb.js'
import { TextInput } from '../ui/Field.js'
import { analyzeSearchUrl, looksLikeSearchUrl } from '../../data/api.js'
import type { CampaignAnalysis } from '../../data/types.js'

type Phase = 'input' | 'analyzing' | 'ready' | 'failed'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

interface StatTile {
  icon: LucideIcon
  value: string
  label: string
  className: string
}

interface CreateCampaignModalProps {
  open: boolean
  onClose: () => void
  onCreated: (analysis: CampaignAnalysis, name: string) => void
}

export function CreateCampaignModal({
  open,
  onClose,
  onCreated
}: CreateCampaignModalProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('input')
  const [url, setUrl] = useState('')
  const [touched, setTouched] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Starting analysis…')
  const [analysis, setAnalysis] = useState<CampaignAnalysis | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)

  // Reset every time the dialog is reopened.
  useEffect(() => {
    if (!open) return
    cancelled.current = false
    setPhase('input')
    setUrl('')
    setTouched(false)
    setProgress(0)
    setStatus('Starting analysis…')
    setAnalysis(null)
    setName('')
    setError(null)
    return () => {
      cancelled.current = true
    }
  }, [open])

  const valid = looksLikeSearchUrl(url)
  const showError = touched && url.trim().length > 0 && !valid

  const startAnalysis = async (): Promise<void> => {
    if (!valid) {
      setTouched(true)
      return
    }

    setPhase('analyzing')
    setProgress(0)
    setError(null)

    try {
      const result = await analyzeSearchUrl(url, (step) => {
        if (cancelled.current) return
        setProgress(step.progress)
        setStatus(step.label)
      })
      if (cancelled.current) return
      setAnalysis(result)
      setName(result.suggestedName)
      setPhase('ready')
    } catch (caught) {
      if (cancelled.current) return
      setError((caught as Error).message)
      setPhase('failed')
    }
  }

  const tiles: StatTile[] = analysis
    ? [
        {
          icon: Users,
          value: analysis.targetProspects.toLocaleString(),
          label: 'Target Prospects',
          className: 'text-brand-500'
        },
        {
          icon: CalendarDays,
          value: `${analysis.estimatedDurationDays} Days`,
          label: 'Estimated Duration',
          className: 'text-success'
        },
        {
          icon: Send,
          value: `${analysis.dailyConnections} / Day`,
          label: 'Daily Connections',
          className: 'text-accent'
        },
        {
          icon: Target,
          value: formatDate(analysis.expectedCompletion),
          label: 'Expected Completion',
          className: 'text-warn'
        }
      ]
    : []

  const titles: Record<Phase, { title: string; subtitle?: string }> = {
    input: {
      title: 'Create New Campaign',
      subtitle: 'Paste a LinkedIn search URL and Claude will analyse your audience'
    },
    analyzing: { title: 'Analysing your search' },
    ready: { title: 'Campaign Ready' },
    failed: { title: 'Analysis failed' }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={phase !== 'analyzing'}
      icon={<Sparkles size={17} strokeWidth={2.2} fill="currentColor" />}
      title={titles[phase].title}
      subtitle={titles[phase].subtitle}
      width={phase === 'ready' ? 'max-w-[680px]' : 'max-w-[600px]'}
      footer={
        phase === 'ready' ? (
          <div className="flex items-center justify-between gap-3">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => analysis && onCreated(analysis, name.trim() || analysis.suggestedName)}
              icon={<ArrowRight size={16} strokeWidth={2.2} className="order-2" />}
              className="[&>svg]:order-2"
            >
              Approve &amp; Create Campaign
            </Button>
          </div>
        ) : undefined
      }
    >
      {phase === 'input' && (
        <div className="animate-fadeSlideUp">
          <label className="mb-1.5 block text-[13px] font-semibold text-ink">
            LinkedIn search URL
          </label>
          <TextInput
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(event) => event.key === 'Enter' && void startAnalysis()}
            placeholder="https://www.linkedin.com/sales/search/…"
            className={showError ? 'border-danger focus:border-danger' : undefined}
          />

          {showError ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-danger">
              <TriangleAlert size={13} strokeWidth={2.2} />
              That is not a Sales Navigator or people search URL.
            </p>
          ) : (
            <p className="mt-2 text-xs text-ink-subtle">
              Run your search in Sales Navigator or LinkedIn search, then copy the address bar.
            </p>
          )}

          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => void startAnalysis()}
            icon={<Sparkles size={16} strokeWidth={2.2} />}
            className="mt-5 w-full justify-center"
          >
            Analyse with Claude
          </Button>
        </div>
      )}

      {phase === 'analyzing' && (
        <div className="flex animate-fadeSlideUp flex-col items-center pb-2 pt-1">
          <AnalysisOrb />

          <h3 className="mt-4 text-lg font-bold tracking-tight text-ink">Opening your search</h3>
          {/* Keyed so each new status re-runs the fade animation. */}
          <p key={status} className="mt-1 animate-msgFade text-center text-[13px] text-ink-muted">
            {status}
          </p>

          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="mt-2.5 text-xs text-ink-subtle">
            Reading the real search results as your LinkedIn account.
          </p>
        </div>
      )}

      {phase === 'failed' && (
        <div className="animate-fadeSlideUp">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
              <TriangleAlert size={22} strokeWidth={2.2} className="text-danger" />
            </span>
            <h3 className="mt-3 text-lg font-bold tracking-tight text-ink">
              Could not analyse that search
            </h3>
            <p className="mt-1.5 max-w-[440px] text-[13px] leading-relaxed text-ink-muted">
              {error}
            </p>
          </div>

          <div className="mt-5 flex gap-2">
            <Button className="flex-1 justify-center" onClick={() => setPhase('input')}>
              Change the URL
            </Button>
            <Button
              variant="primary"
              className="flex-1 justify-center"
              onClick={() => void startAnalysis()}
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      {phase === 'ready' && analysis && (
        <div className="animate-fadeSlideUp">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-12 w-12 animate-checkPop items-center justify-center rounded-full bg-emerald-100">
              <Check size={24} strokeWidth={3} className="text-success" />
            </span>
            <h3 className="mt-3 text-lg font-bold tracking-tight text-ink">
              Campaign Analysis Complete
            </h3>
            <p className="mt-1 max-w-[460px] text-[13px] text-ink-muted">
              Claude read your search results and prepared a plan within your automation limits.
            </p>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center gap-2">
              <label className="text-[13px] font-semibold text-ink">Campaign name</label>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-500">
                <Sparkles size={10} strokeWidth={2.6} />
                Suggested by Claude
              </span>
            </div>
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="bg-brand-50/60"
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((tile, index) => {
              const Icon = tile.icon
              return (
                <div
                  key={tile.label}
                  style={{ animationDelay: `${index * 60}ms` }}
                  className="animate-successBurst rounded-xl border border-line bg-white px-3 py-3.5 text-center"
                >
                  <Icon size={18} strokeWidth={2.1} className={`mx-auto ${tile.className}`} />
                  <p className={`mt-1.5 text-[15px] font-bold ${tile.className}`}>{tile.value}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">{tile.label}</p>
                </div>
              )
            })}
          </div>

          <div className="mt-4 rounded-xl border border-line bg-canvas px-4 py-3.5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-muted">
              What Claude found
            </p>
            <ul className="flex flex-col gap-1.5">
              {analysis.recommendations.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[13px] text-ink">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check size={10} strokeWidth={3.2} className="text-success" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {analysis.sampleProspects.length > 0 && (
            <div className="mt-3 rounded-xl border border-line bg-white px-4 py-3.5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-muted">
                People in this search
              </p>
              <ul className="flex flex-col gap-1.5">
                {analysis.sampleProspects.slice(0, 4).map((person) => (
                  <li key={person.profileUrl} className="truncate text-[12px] text-ink-muted">
                    <span className="font-medium text-ink">{person.fullName}</span>
                    {person.headline && ` — ${person.headline}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 rounded-xl border border-brand-500/15 bg-gradient-to-br from-brand-50 to-violet-50 px-4 py-3.5">
            <p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Sparkles size={13} strokeWidth={2.4} className="text-brand-500" />
              How this campaign was paced
            </p>
            <p className="text-xs leading-relaxed text-ink-muted">
              LinkedIn reported{' '}
              <strong className="font-semibold text-ink">
                {analysis.totalMatches.toLocaleString()} matches
              </strong>
              , of which{' '}
              <strong className="font-semibold text-ink">
                {analysis.rationale.prospects.toLocaleString()} are reachable
              </strong>
              . {analysis.rationale.explanation} Completing on{' '}
              <strong className="font-semibold text-ink">
                {formatDate(analysis.rationale.completionDate)}
              </strong>
              .
            </p>
          </div>
        </div>
      )}
    </Modal>
  )
}
