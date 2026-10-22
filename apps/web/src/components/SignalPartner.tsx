import type { SignalOrigin } from '../signup/signal-prefill'

/** Page class for a partner's colours (styles.css .partner-iaz). Ти Броиш header and footer stay. */
export function partnerClass(origin: SignalOrigin | undefined) {
  return origin === 'iaz' ? 'partner-iaz' : ''
}

/** Co-branding note on /signal?origin=iaz. Colours and mark are from iaz.bg (logo in public/partners). */
export function SignalPartnerBanner({ origin }: { origin: SignalOrigin | undefined }) {
  if (origin !== 'iaz') return null
  return (
    <aside className="iaz-banner" aria-label="Партньор: И аз">
      <a className="iaz-banner__partner" href="https://iaz.bg/" target="_blank" rel="noopener noreferrer">
        <img src="/partners/iaz-logo.svg" alt="" width={44} height={44} />
        <span className="grid">
          <span className="iaz-banner__eyebrow">Партньор на Ти Броиш</span>
          <span className="iaz-wordmark">
            Гюров, Кандев <span>и аз</span>
          </span>
        </span>
      </a>
      <p className="iaz-banner__title">
        <span>„И аз“</span> работи заедно с Ти Броиш
      </p>
      <p className="iaz-banner__text">Сигналът ти стига направо до екипа на Ти Броиш, който го преглежда.</p>
      <a className="iaz-banner__link" href="https://iaz.bg/" target="_blank" rel="noopener noreferrer">
        iaz.bg
        <span aria-hidden="true">→</span>
      </a>
    </aside>
  )
}
