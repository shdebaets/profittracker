import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { RegisterSW } from "@/components/register-sw"
import "./globals.css"

// The brand type from the FlipLedger design: Inter for text, Space Grotesk for headings, JetBrains Mono for money.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] })
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], weight: ["500", "600", "700"] })
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], weight: ["500", "700"] })

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
