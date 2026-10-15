import { useState, type FormEvent } from 'react'
import { api, setToken } from '../services/api'

type LoginScreenProps = {
  onLoggedIn: () => void
}

// Phase 4, ems mode only. Minimal: email + password, the same auth
// endpoint ems-frontend uses (POST /auth/login). Reuses the app's
// existing .card/.form-group/.btn classes -- no new styling system.
function LoginScreen({ onLoggedIn }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const result = await api.login(email.trim(), password)
      setToken(result.accessToken)
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log in')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app">
      <header className="page-header">
        <div>
          <h1>Quotation</h1>
          <p>Sign in to continue (ems mode)</p>
        </div>
      </header>

      <main className="quotation-page login-page">
        <section className="card login-card">
          <div className="section-header">
            <h2>Sign in</h2>
          </div>

          <form onSubmit={(event) => void handleSubmit(event)}>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && <p className="quotation-actions-error">{error}</p>}

            <div className="quotation-actions-buttons">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  )
}

export default LoginScreen
