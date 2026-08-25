interface LogoProps {
  size?: number
  className?: string
}

/**
 * The app mark: a send arrow leaving a small network.
 *
 * Kept in sync by hand with `build/logo.svg`, which `scripts/make_icon.py`
 * rasterises into the Windows icon — same geometry in all three places, so the
 * taskbar, the installer and the title bar agree.
 *
 * Deliberately not LinkedIn's "in" glyph: that is a registered trademark and
 * this app is distributed. The blue and the squircle are the category's visual
 * language, which reads as "LinkedIn tool" without pretending to be LinkedIn.
 */
export function Logo({ size = 30, className }: LogoProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="LinkedIn Outreach"
    >
      <defs>
        {/* Scoped id so two Logos on one page cannot fight over the gradient. */}
        <linearGradient id="oa-logo-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="14" fill="url(#oa-logo-bg)" />

      <path
        d="M15 44 L25 39"
        stroke="#FFFFFF"
        strokeOpacity="0.45"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="14" cy="45" r="3.2" fill="#FFFFFF" fillOpacity="0.55" />
      <circle cx="26" cy="38.5" r="2.4" fill="#FFFFFF" fillOpacity="0.55" />

      {/* The lower wing is the paper fold, so it sits a shade back. */}
      <path d="M50 14 L28.5 46 L24 30.5 Z" fill="#FFFFFF" fillOpacity="0.78" />
      <path d="M50 14 L24 30.5 L10.5 26 Z" fill="#FFFFFF" />
    </svg>
  )
}
