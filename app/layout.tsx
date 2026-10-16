import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { RegisterSW } from "@/components/register-sw"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        {children}
        <Toaster position="top-center" richColors />
        <RegisterSW />
      </body>
    </html>
  )
}
