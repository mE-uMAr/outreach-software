import { Check, Save } from 'lucide-react'
import { Button } from '../ui/Button.js'

interface SaveBarProps {
  dirty: boolean
  saving: boolean
  savedAt: number | null
  onSave: () => void
  onDiscard: () => void
}

/**
 * Fixed action bar. It only appears once something has actually changed, so the
 * settings page is quiet until the user edits it.
 */
export function SaveBar({ dirty, saving, savedAt, onSave, onDiscard }: SaveBarProps): JSX.Element | null {
  if (!dirty && !savedAt) return null

  if (!dirty && savedAt) {
    return (
      <div className="fixed bottom-6 right-8 z-[200] animate-slideIn">
        <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-emerald-50 px-3.5 py-2.5 text-[13px] font-medium text-success shadow-card">
          <Check size={15} strokeWidth={2.5} />
          Settings saved
        </div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-6 right-8 z-[200] flex animate-slideIn items-center gap-3">
      <span className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-[13px] text-ink-muted shadow-card">
        You have unsaved changes
      </span>
      <Button onClick={onDiscard} disabled={saving}>
        Discard
      </Button>
      <Button
        variant="primary"
        onClick={onSave}
        disabled={saving}
        icon={<Save size={15} strokeWidth={2} />}
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </Button>
    </div>
  )
}
