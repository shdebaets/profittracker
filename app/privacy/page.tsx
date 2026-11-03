import type { Metadata } from "next"
import Link from "next/link"
import { Logo } from "@/components/logo"

export const metadata: Metadata = { title: "Privacy policy · FlipLedger" }

// Public (see PUBLIC_PATHS in proxy.ts): the Chrome Web Store listing links here.
// Keep it in step with what the app and extension actually do.
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 text-sm leading-relaxed">
      <Link href="/" className="flex items-center gap-2 self-start font-bold">
        <Logo size={32} /> FlipLedger
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Privacy policy</h1>
        <p className="text-muted-foreground">Last updated November 3, 2026</p>
      </div>

      <Section title="What FlipLedger stores">
        <p>FlipLedger keeps the records you enter so it can track your profit and your listings:</p>
        <ul className="list-disc pl-5">
          <li>Your email address, to sign you in.</li>
          <li>Your items, photos, costs, sales, expenses and settings.</li>
          <li>Your marketplace listings: which sites an item is listed on, the listing links and prices.</li>
          <li>If you connect eBay, the access tokens eBay gives us, stored encrypted. We never see your eBay password.</li>
        </ul>
        <p>Your data is private to your account. Other FlipLedger users can&apos;t see it.</p>
      </Section>

      <Section title="The FlipLedger Lister Chrome extension">
        <p>The extension fills in and manages listings on Facebook Marketplace, Poshmark and Mercari for you, in your own browser. It:</p>
        <ul className="list-disc pl-5">
          <li>Opens and reads those sites only when you start something from FlipLedger (list, delist, import), or to check whether your own listings have sold while FlipLedger is open.</li>
          <li>Sends FlipLedger only what it needs for that: the link and status of your listings, and the details of listings you choose to import.</li>
          <li>Downloads your item photos from FlipLedger&apos;s storage to put them into the listing form.</li>
          <li>Saves its in-progress tasks in your browser and deletes them when they finish.</li>
        </ul>
        <p>It never reads or stores your marketplace passwords, messages, or your browsing on other sites, and it doesn&apos;t track you.</p>
      </Section>

      <Section title="Who we share it with">
        <p>
          We don&apos;t sell your data or use it for advertising. It&apos;s stored with our hosting providers (Supabase for the database and
          photos, Vercel for the app), who process it only to run FlipLedger. When you list on eBay, the listing details and photos you
          choose are sent to eBay.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          You can delete items, photos and expenses in the app at any time, and disconnect eBay in Settings, which deletes its tokens.
          Removing the extension deletes everything it saved in your browser. To delete your whole account, contact us and we&apos;ll remove
          it and all its data.
        </p>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}
