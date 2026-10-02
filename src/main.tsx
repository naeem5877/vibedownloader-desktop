import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import './index.css'
import App from './App.tsx'

// Renderer-side reporting. No DSN here on purpose: this build of the SDK ships
// renderer events to the main process, which already holds the DSN, so there is
// one place to configure and nothing to keep in sync.
//
// With this in place the SDK installs its own global handlers, which is what
// catches the failures that never reach an IPC handler: a React render that
// throws, an undefined function in a click handler, a rejected promise nobody
// awaited. Those used to die silently in the console.
//
// The integration list is deliberately short, because the defaults collect
// things this app should not be sending: console breadcrumbs (the UI logs the
// URL the user pasted) and HTTP instrumentation (every request it makes, with
// its query string). The logs worth having are in the main process, where the
// extraction diagnostics already live - redacted at the source.
Sentry.init({
  defaultIntegrations: false,
  integrations: [
    // Uncaught exceptions and unhandled rejections in the page.
    Sentry.globalHandlersIntegration(),
    // Clicks and navigation, but not console output.
    Sentry.breadcrumbsIntegration({ console: false }),
    // The same error thrown twice is one issue.
    Sentry.dedupeIntegration()
  ],
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  maxBreadcrumbs: 50
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
