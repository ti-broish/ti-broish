// Optional reCAPTCHA v3 for signals, like the old form. Off unless VITE_RECAPTCHA_SITE_KEY is set at build time;
// the API also skips the check while GOOGLE_RECAPTCHA_ENABLED is false.
interface Grecaptcha {
  ready(callback: () => void): void
  execute(siteKey: string, options: { action: string }): Promise<string>
}

const SITE_KEY = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined) ?? ''

let loading: Promise<Grecaptcha | null> | null = null

function load(): Promise<Grecaptcha | null> {
  if (!SITE_KEY || typeof window === 'undefined') return Promise.resolve(null)
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(SITE_KEY)}`
    script.async = true
    script.onload = () => {
      const grecaptcha = (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha
      if (!grecaptcha) return resolve(null)
      grecaptcha.ready(() => resolve(grecaptcha))
    }
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
  })
  return loading
}

export const recaptchaEnabled = Boolean(SITE_KEY)

export async function recaptchaToken(action: string): Promise<string> {
  const grecaptcha = await load()
  if (!grecaptcha) return ''
  return grecaptcha.execute(SITE_KEY, { action })
}
