import { cn } from "@/lib/utils"

type PromptDeckLogoProps = {
  className?: string
  /** Override when several logos render in the same document, so gradient ids stay unique. */
  gradientId?: string
  title?: string
}

/**
 * PromptDeck brand mark: a staggered deck of prompt cards with a terminal-style
 * chevron and caret. Kept as inline SVG so it stays crisp at every size and can be
 * sized with utility classes.
 */
export function PromptDeckLogo({
  className,
  gradientId = "promptdeck-logo-gradient",
  title = "PromptDeck",
}: PromptDeckLogoProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      className={cn("size-7 shrink-0", className)}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7C3AED" />
          <stop offset="0.55" stopColor="#A21CAF" />
          <stop offset="1" stopColor="#DB2777" />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="112" fill={`url(#${gradientId})`} />

      <rect x="152" y="100" width="288" height="56" rx="28" fill="#FFFFFF" opacity="0.28" />
      <rect x="132" y="140" width="288" height="56" rx="28" fill="#FFFFFF" opacity="0.52" />
      <rect x="112" y="180" width="288" height="224" rx="32" fill="#FFFFFF" />

      <g fill="none" stroke="#3B0764" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="188,244 236,292 188,340" />
        <line x1="268" y1="340" x2="322" y2="340" />
      </g>
    </svg>
  )
}
