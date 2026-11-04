import type { Metadata } from "next"
import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { Logo } from "@/components/logo"
import { EXTENSION_STORE_URL } from "@/lib/marketplaces/registry"

export const metadata: Metadata = { title: "Chrome extension guide · FlipLedger" }

// Public (see PUBLIC_PATHS in proxy.ts) so it can be shared before someone signs up.
// Keep it in step with what the extension actually does (extension/README.md).
export default function ExtensionGuidePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 text-sm leading-relaxed">
      <Link href="/" className="flex items-center gap-2 self-start font-bold">
        <Logo size={32} /> FlipLedger
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">FlipLedger Lister: how to use it</h1>
        <p className="text-muted-foreground">
          The Chrome extension fills in your Facebook Marketplace, Poshmark and Mercari listings from FlipLedger, and helps take them down when
          an item sells. It works on a computer in Chrome. On your phone, use the copy kit instead.
        </p>
      </div>

      <a
        href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer"
        className="inline-flex h-11 items-center gap-2 self-start rounded-xl bg-ink px-4 font-bold text-white"
      >
        <ExternalLink className="size-4" /> Add to Chrome
      </a>

      <Section title="1. Set it up (once per computer)">
        <ol className="list-decimal pl-5">
          <li>Click <b>Add to Chrome</b> above, then <b>Add extension</b>.</li>
          <li>In the same Chrome, sign in to FlipLedger, and to Facebook, Poshmark and Mercari.</li>
          <li>Open FlipLedger (or reload it). Settings → Marketplaces should say <b>Installed on this computer</b>.</li>
        </ol>
      </Section>

      <Section title="2. List an item">
        <ol className="list-decimal pl-5">
          <li>Open the item in FlipLedger and tap <b>Cross-list</b>.</li>
          <li>Pick Facebook, Poshmark or Mercari and click <b>Auto-fill</b>.</li>
          <li>The site opens in a new tab and fills in your photos, title, description, price, condition, brand, size and a category guessed from the title.</li>
          <li>
            Check what it filled, especially the category, and finish anything it left: on Poshmark the original price, on Mercari the
            shipping.
          </li>
          <li>Click the site&apos;s <b>Publish</b> (or <b>List</b>) button. FlipLedger saves the listing and its link.</li>
        </ol>
        <p>Leave the tab alone while it fills in; it takes a few seconds.</p>
      </Section>

      <Section title="3. When it sells">
        <ul className="list-disc pl-5">
          <li>eBay sales come in on their own, and FlipLedger ends the eBay listing when the item sells elsewhere.</li>
          <li>Poshmark sales are spotted on their own. Mercari sales are spotted while FlipLedger is open on your computer.</li>
          <li>Facebook sales you record yourself: open the item and tap <b>Mark Sold</b>.</li>
          <li>
            The other listings then show up in a red <b>Delist</b> box at the top of FlipLedger. Click ✨ next to each one: the listing opens
            and the button to click is highlighted. FlipLedger marks it ended once it&apos;s gone.
          </li>
        </ul>
        <p>Spotting sales needs each listing&apos;s link saved, which happens automatically when you list with Auto-fill.</p>
      </Section>

      <Section title="4. Bring in listings you already have">
        <p>
          Settings → Marketplaces → <b>Import listings you already have</b>. Poshmark: type your closet name and click <b>Find</b> (works on
          any device). Mercari: click <b>Import from Mercari</b> on your computer and keep that tab in front until it closes. Imported items
          show <b>Add cost</b> until you enter what you paid.
        </p>
      </Section>

      <Section title="5. Optional: let it click for you">
        <p>In Settings → Marketplaces you can turn on, per computer:</p>
        <ul className="list-disc pl-5">
          <li><b>Publish automatically</b>: after Auto-fill, it clicks Publish 5 seconds later (with a Stop button), only if it filled everything.</li>
          <li><b>Delist automatically</b>: when an item sells, it takes the other listings down in background tabs while FlipLedger is open.</li>
        </ul>
        <p>
          Both are off by default. Poshmark and Mercari ban automation, so turning these on could put your accounts at risk. The extension
          never shares, follows or relists.
        </p>
      </Section>

      <Section title="If something's off">
        <ul className="list-disc pl-5">
          <li>No <b>Auto-fill</b> button: make sure you&apos;re in Chrome on a computer with the extension turned on, then reload FlipLedger.</li>
          <li>A field stayed empty: fill it in yourself before you publish. Sites change their forms, so the extension can miss one.</li>
          <li>It filled the wrong category: change it on the site before you publish.</li>
          <li>Something didn&apos;t get delisted: it stays in the Delist box until it&apos;s gone, so nothing slips through.</li>
        </ul>
      </Section>

      <p className="text-muted-foreground">
        The extension never sees your marketplace passwords. <Link href="/privacy" className="underline">Privacy policy</Link>
      </p>
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
