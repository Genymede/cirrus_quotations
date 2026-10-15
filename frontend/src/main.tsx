import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import CostAndProfitPage from './pages/CostAndProfitPage.tsx'

// claude_prompt.txt ("Cost & Profit report"): the app has no router, and
// this is the only second route it needs -- the smallest possible
// pathname-based switch, per the task's own instruction, rather than
// pulling in react-router. `/` and every existing behavior in App.tsx are
// untouched either way.
const isCostAndProfitRoute = window.location.pathname.replace(/\/+$/, '') === '/cost-and-profit'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCostAndProfitRoute ? <CostAndProfitPage /> : <App />}
  </StrictMode>,
)
