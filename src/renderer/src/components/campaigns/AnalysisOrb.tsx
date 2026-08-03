import { Sparkles } from 'lucide-react'

/**
 * The animated core of the analysis step: a glowing sphere, two pulsing rings,
 * counter-rotating arcs and orbiting particles. Everything is CSS/SVG — no
 * images and no runtime cost beyond compositing.
 */
export function AnalysisOrb(): JSX.Element {
  return (
    <div className="relative flex h-[190px] w-[190px] items-center justify-center" aria-hidden>
      {/* Soft halo */}
      <div className="absolute inset-0 rounded-full bg-brand-500/10 blur-2xl" />

      {/* Pulsing rings */}
      <div className="absolute inset-3 animate-pulseRing rounded-full border border-brand-500/30" />
      <div
        className="absolute inset-6 animate-pulseRing rounded-full border border-brand-500/25"
        style={{ animationDelay: '0.8s' }}
      />

      {/* Counter-rotating arcs */}
      <svg className="absolute inset-0 h-full w-full animate-spinSlow" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke="#2563EB"
          strokeOpacity="0.55"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="70 210"
        />
      </svg>
      <svg className="absolute inset-0 h-full w-full animate-spinReverse" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="#2563EB"
          strokeOpacity="0.3"
          strokeWidth="1"
          strokeLinecap="round"
          strokeDasharray="30 180"
        />
      </svg>

      {/* Orbiting particles */}
      <div className="absolute inset-0 animate-spinSlow">
        {[0, 72, 144, 216, 288].map((angle) => (
          <span
            key={angle}
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-brand-500"
            style={{ transform: `rotate(${angle}deg) translateY(-84px)` }}
          />
        ))}
      </div>

      {/* Core */}
      <div className="relative flex h-[104px] w-[104px] animate-orbGlow items-center justify-center rounded-full bg-gradient-to-br from-[#4C8DFF] via-brand-500 to-brand-700">
        <Sparkles size={26} strokeWidth={2.2} className="text-white drop-shadow" fill="currentColor" />
      </div>
    </div>
  )
}
