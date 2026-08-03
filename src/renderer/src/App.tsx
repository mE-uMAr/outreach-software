import { useState } from 'react'
import { TopNav, type Route } from './components/layout/TopNav.js'
import { CampaignsPage } from './pages/CampaignsPage.js'
import { SettingsPage } from './pages/SettingsPage.js'

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>('campaigns')

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <TopNav route={route} onNavigate={setRoute} />
      {/* Settings owns its own scroll containers (sidebar + panel), so the shell
          just hands it the remaining height. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {route === 'campaigns' ? (
          <div className="flex-1 overflow-y-auto">
            <CampaignsPage />
          </div>
        ) : (
          <SettingsPage onBackToDashboard={() => setRoute('campaigns')} />
        )}
      </div>
    </div>
  )
}
