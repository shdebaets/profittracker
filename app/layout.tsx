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

export const metadata: Metadata = {
  title: "FlipLedger",
  description: "Track resale revenue, profit, inventory and business expenses.",
  appleWebApp: { capable: true, title: "FlipLedger", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
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
