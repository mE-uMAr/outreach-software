import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { SettingsSidebar, SETTINGS_SECTIONS } from '../components/settings/SettingsSidebar.js'
import { WeeklyScheduleCard } from '../components/settings/WeeklyScheduleCard.js'
import { ActivityLimitsCard } from '../components/settings/ActivityLimitsCard.js'
import { FollowUpRulesCard } from '../components/settings/FollowUpRulesCard.js'
import { MessageTemplatesCard } from '../components/settings/MessageTemplatesCard.js'
import { SheetsIntegrationCard } from '../components/settings/SheetsIntegrationCard.js'
import { AiConnectionCard } from '../components/settings/AiConnectionCard.js'
import { BrowserAutomationCard } from '../components/settings/BrowserAutomationCard.js'
import { LinkedInAccountCard } from '../components/settings/LinkedInAccountCard.js'
import { UsageCard } from '../components/settings/UsageCard.js'
import { SaveBar } from '../components/settings/SaveBar.js'
import { getSettings, saveSettings } from '../data/api.js'
import type { AutomationSettings } from '../data/types.js'

interface SettingsPageProps {
  onBackToDashboard: () => void
  /** Called when an account is disconnected, so the shell can re-gate the app. */
  onDisconnected: () => void
}

export function SettingsPage({
  onBackToDashboard,
  onDisconnected
}: SettingsPageProps): JSX.Element {
  const [saved, setSaved] = useState<AutomationSettings | null>(null)
  const [draft, setDraft] = useState<AutomationSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [activeId, setActiveId] = useState(SETTINGS_SECTIONS[0].id)
  const scrollRef = useRef<HTMLElement>(null)

  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void getSettings()
      .then((settings) => {
        setSaved(settings)
        setDraft(structuredClone(settings))
      })
      .catch((error: Error) => setLoadError(error.message))
  }, [])

  const dirty = useMemo(
    () => Boolean(saved && draft) && JSON.stringify(saved) !== JSON.stringify(draft),
    [saved, draft]
  )

  const patch = useCallback((changes: Partial<AutomationSettings>) => {
    setDraft((current) => (current ? { ...current, ...changes } : current))
    setSavedAt(null)
  }, [])

  const onSave = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const persisted = await saveSettings(draft)
      setSaved(persisted)
      setDraft(structuredClone(persisted))
      setSavedAt(Date.now())
    } catch (error) {
      setLoadError((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const onDiscard = (): void => {
    if (saved) setDraft(structuredClone(saved))
    setSavedAt(null)
  }

  const scrollTo = (id: string): void => {
    setActiveId(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Highlight the sidebar entry for whichever section is nearest the top.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !draft) return

    const onScroll = (): void => {
      const top = container.getBoundingClientRect().top
      let current = SETTINGS_SECTIONS[0].id
      for (const section of SETTINGS_SECTIONS) {
        const element = document.getElementById(section.id)
        if (element && element.getBoundingClientRect().top - top <= 24) current = section.id
      }
      setActiveId(current)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [draft])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <SettingsSidebar
        activeId={activeId}
        onSelect={scrollTo}
        onBackToDashboard={onBackToDashboard}
      />

      <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-10 pb-[120px] pt-8">
        <header className="mb-8 animate-fadeIn">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-brand-50">
              <SettingsIcon size={20} strokeWidth={2} className="text-brand-500" />
            </span>
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">
              Automation Settings
            </h1>
          </div>
          <p className="ml-12 max-w-[560px] text-sm leading-relaxed text-ink-muted">
            Configure how AI performs LinkedIn outreach, follow-ups, daily limits, and message
            templates.
          </p>
        </header>

        {loadError && (
          <p className="mb-5 rounded-xl border border-danger/20 bg-red-50 px-4 py-3 text-[13px] text-danger">
            {loadError}
          </p>
        )}

        {draft ? (
          <div className="flex flex-col gap-5">
            <LinkedInAccountCard onDisconnected={onDisconnected} />
            <WeeklyScheduleCard
              schedule={draft.schedule}
              onChange={(schedule) => patch({ schedule })}
            />
            <ActivityLimitsCard limits={draft.limits} onChange={(limits) => patch({ limits })} />
            <FollowUpRulesCard
              rules={draft.followUps}
              onChange={(followUps) => patch({ followUps })}
            />
            <MessageTemplatesCard
              templates={draft.templates}
              onChange={(templates) => patch({ templates })}
            />
            <SheetsIntegrationCard sheets={draft.sheets} />
            <BrowserAutomationCard
              settings={draft.browser}
              onChange={(browser) => patch({ browser })}
            />
            <AiConnectionCard connection={draft.ai} onChange={(ai) => patch({ ai })} />
            <UsageCard />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="h-56 animate-pulse rounded-card border border-line bg-white"
              />
            ))}
          </div>
        )}
      </main>

      <SaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        onSave={() => void onSave()}
        onDiscard={onDiscard}
      />
    </div>
  )
}
