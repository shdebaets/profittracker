import Image from "next/image"

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Image
      src="/icons/icon-192.png" alt="FlipLedger" width={size} height={size}
      className="rounded-[22%] shadow-sm" priority
    />
  )
}
