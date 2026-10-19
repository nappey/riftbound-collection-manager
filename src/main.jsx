import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyTheme, loadThemeId } from './themes'
// Phone layout last, so it overrides desktop and theme styles.
import './mobile.css'

// Before the first render, so the saved theme shows without a flash.
applyTheme(loadThemeId())

// Lets CSS adapt per OS (e.g. room for the macOS traffic-light buttons).
const platform = window.__electron__?.platform
if (platform) document.documentElement.classList.add(`platform-${platform}`)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
