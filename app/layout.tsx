import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Toaster } from "@/components/ui/sonner"
import { RegisterSW } from "@/components/register-sw"
import "./globals.css"

// The brand type from the FlipLedger design: Inter for text, Space Grotesk for headings, JetBrains Mono for money.
// Self-hosted (latin variable fonts from @fontsource-variable, OFL-1.1) so builds never download from Google Fonts;
// next/font/google failed Vercel builds whenever that download did.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
})
const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk-latin-wght-normal.woff2",
  variable: "--font-space-grotesk",
  weight: "300 700",
  display: "swap",
})
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
  display: "swap",
})

const DESCRIPTION = "Track resale revenue, profit, inventory and business expenses."

export const metadata: Metadata = {
  metadataBase: new URL(`https://${process.env.CANONICAL_HOST?.trim() || "profit.emoneydeals.com"}`),
  title: "FlipLedger",
  description: DESCRIPTION,
  applicationName: "FlipLedger",
  // The share image is app/opengraph-image.png (picked up automatically).
  openGraph: { type: "website", siteName: "FlipLedger", title: "FlipLedger", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "FlipLedger", description: DESCRIPTION },
  appleWebApp: { capable: true, title: "FlipLedger", statusBarStyle: "default" },
  // Icons come from the file conventions: app/favicon.ico, app/icon.svg, app/icon.png, app/apple-icon.png.
  // (Setting `icons` here would replace them, and the tab would fall back to the low-res favicon.ico.)
}

export const viewport: Viewport = {
  themeColor: "#f7f6f3",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        {children}
        <Toaster position="top-center" richColors />
        <RegisterSW />
      </body>
    </html>
  )
}
