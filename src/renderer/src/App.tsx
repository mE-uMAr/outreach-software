import { useState } from 'react'
import { TopNav, type Route } from './components/layout/TopNav.js'
import { CampaignsPage } from './pages/CampaignsPage.js'
import { SettingsPage } from './pages/SettingsPage.js'

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>('campaigns')

  return (
    <div className="min-h-full bg-canvas">
      <TopNav route={route} onNavigate={setRoute} />
      <main>{route === 'campaigns' ? <CampaignsPage /> : <SettingsPage />}</main>
    </div>
  )
}
