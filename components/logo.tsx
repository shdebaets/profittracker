import Image from "next/image"

// Brand files come from scripts/brand-assets.mjs (source: brand/flipledger-logo-source.png).
const WORDMARK_ASPECT = 828 / 160

/** The FlipLedger app icon (dark rounded square with the orange "F"). */
export function Logo({ size = 40 }: { size?: number }) {
  return <Image src="/icons/icon-192.png" alt="FlipLedger" width={size} height={size} className="shrink-0" priority />
}

/** The "FlipLedger" wordmark. Shows white "Flip" inside a `.dark` container, black "Flip" elsewhere.
 *  `heightClass` (e.g. "h-5 sm:h-6") sizes it responsively instead of the fixed `height`. */
export function Wordmark({ height = 24, heightClass }: { height?: number; heightClass?: string }) {
  const width = Math.round(height * WORDMARK_ASPECT)
  const img = "h-full w-auto max-w-none"
  return (
    <span className={`inline-flex shrink-0 ${heightClass ?? ""}`} style={heightClass ? undefined : { height }}>
      <Image src="/brand/wordmark-light.png" alt="FlipLedger" width={width} height={height} className={`${img} dark:hidden`} priority />
      <Image src="/brand/wordmark-dark.png" alt="" aria-hidden width={width} height={height} className={`${img} hidden dark:block`} priority />
    </span>
  )
}
