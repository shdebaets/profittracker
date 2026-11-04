import type { Metadata } from "next"
import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { Logo } from "@/components/logo"
import { EXTENSION_STORE_URL } from "@/lib/marketplaces/registry"

export const metadata: Metadata = { title: "Chrome extension guide · FlipLedger" }

// Public (see PUBLIC_PATHS in proxy.ts) so it can be shared before someone signs up.
// Written for first-time users: one action per step, named exactly as on screen.
// Keep it in step with the app's labels and what the extension does (extension/README.md).
export default function ExtensionGuidePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-7 px-4 py-10 text-sm leading-relaxed">
      <Link href="/" className="flex items-center gap-2 self-start font-bold">
        <Logo size={32} /> FlipLedger
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Post to Facebook, Poshmark and Mercari in a few clicks</h1>
        <p className="text-muted-foreground">
          The FlipLedger Lister extension copies an item from FlipLedger into the listing form on Facebook Marketplace, Poshmark or Mercari:
          photos, title, price and the rest. You check it and press Publish. Setup takes about 2 minutes.
        </p>
      </div>

      <Box title="Before you start, you need">
        <ul className="list-disc pl-5">
          <li>A <b>computer</b> (Windows or Mac). The extension doesn&apos;t work on phones or tablets.</li>
          <li>The <b>Google Chrome</b> browser. Not Safari or Firefox.</li>
          <li>A FlipLedger account (<Link href="/login" className="underline">sign up here</Link> if you don&apos;t have one).</li>
          <li>Your Facebook, Poshmark and/or Mercari logins.</li>
        </ul>
      </Box>

      <Section title="Part 1: Install it (once per computer)">
        <Steps>
          <li>
            Open Chrome and click this button:
            <a
              href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer"
              className="my-2 flex h-11 w-fit items-center gap-2 rounded-xl bg-ink px-4 font-bold text-white"
            >
              <ExternalLink className="size-4" /> Add to Chrome
            </a>
          </li>
          <li>On the page that opens, click the blue <b>Add to Chrome</b> button, then <b>Add extension</b> in the pop-up.</li>
          <li>In the same Chrome window, log in to Facebook, Poshmark and Mercari (whichever you sell on). Stay logged in.</li>
          <li>Go to FlipLedger and log in. If it was already open, refresh the page.</li>
          <li>
            Check it worked: click the <b>gear icon</b> (top right) to open Settings, and scroll to <b>Marketplaces</b>. It should say{" "}
            <b>Installed on this computer</b>. If it still shows an <b>Add to Chrome</b> button, refresh the page.
          </li>
        </Steps>
        <Tip>You never need to click the extension&apos;s icon in Chrome&apos;s toolbar. Everything starts from FlipLedger.</Tip>
      </Section>

      <Section title="Part 2: List an item">
        <Steps>
          <li>In FlipLedger, tap <b>Inventory</b> and open the item you want to sell.</li>
          <li>Tap <b>Cross-list</b>.</li>
          <li>
            Fill in the <b>Listing details</b> box at the top: title, description, price, condition, brand, size. Tap <b>Save details</b>.
            This is what gets copied to every site, so get it right once.
          </li>
          <li>Under <b>Marketplaces</b>, tap <b>Facebook Marketplace</b>, <b>Poshmark</b> or <b>Mercari</b> to open it.</li>
          <li>Click the black <b>Auto-fill</b> button.</li>
          <li>
            A new tab opens on that site and fills itself in. <b>Don&apos;t click anything until it stops</b> (a few seconds). A small
            FlipLedger box on the page tells you when it&apos;s done and what it couldn&apos;t fill.
          </li>
          <li>
            Look it over. Fix the <b>category</b> if it guessed wrong, and fill anything left empty. Poshmark always asks you for the{" "}
            <b>original price</b>; Mercari asks you to pick <b>shipping</b>.
          </li>
          <li>Click the site&apos;s own <b>Publish</b> or <b>List</b> button.</li>
          <li>Done. Back in FlipLedger, that marketplace now shows as listed, with the link saved.</li>
        </Steps>
        <Tip>Repeat steps 4–8 for each site you want the item on.</Tip>
      </Section>

      <Section title="Part 3: When it sells">
        <p>So you don&apos;t sell the same item twice, the other listings need to come down.</p>
        <Steps>
          <li>
            FlipLedger notices the sale for you on eBay and Poshmark. For Mercari, it notices while FlipLedger is open on your computer. For
            Facebook, open the item and tap <b>Mark Sold</b> yourself.
          </li>
          <li>A red <b>Delist</b> box then appears at the top of FlipLedger, showing where the item is still up. (eBay is taken down for you.)</li>
          <li>Click the ✨ button next to each one. The listing opens and the button you need to click is highlighted.</li>
          <li>Click that button on the site. FlipLedger removes it from the red box once it&apos;s gone.</li>
        </Steps>
      </Section>

      <Section title="Already have listings? Bring them in">
        <p>Open Settings (gear icon) → <b>Marketplaces</b> → <b>Import listings you already have</b>.</p>
        <ul className="list-disc pl-5">
          <li><b>Poshmark:</b> type your Poshmark username and click <b>Find</b>.</li>
          <li>
            <b>Mercari:</b> on your computer, click <b>Import from Mercari</b>. A Mercari tab opens and scrolls by itself. Leave it on screen
            until it closes.
          </li>
        </ul>
        <p>
          FlipLedger shows how many it found. Click <b>Import</b>. Imported items say <b>Needs Cost</b> until you enter what you paid, so your
          profit adds up.
        </p>
      </Section>

      <Section title="On your phone">
        <p>
          The extension only runs on a computer. On your phone, open the item, tap <b>Cross-list</b>, open a marketplace, and use the{" "}
          <b>Copy</b> buttons to paste the title, description and price into that site&apos;s app. Then paste the listing&apos;s link into
          FlipLedger and tap <b>I listed it</b>.
        </p>
      </Section>

      <Section title="Optional: let it press the buttons too">
        <p>In Settings → <b>Marketplaces</b> there are two switches, both off to start:</p>
        <ul className="list-disc pl-5">
          <li><b>Publish automatically</b>: after Auto-fill, it presses Publish for you 5 seconds later (with a Stop button), only if nothing was left empty.</li>
          <li><b>Delist automatically</b>: when something sells, it takes the other listings down for you while FlipLedger is open.</li>
        </ul>
        <p className="font-semibold">
          Poshmark and Mercari don&apos;t allow automation, so these switches could get your account flagged. Leave them off if you&apos;re unsure.
        </p>
      </Section>

      <Section title="Something not working?">
        <dl className="flex flex-col gap-3">
          <Faq q="I don't see an Auto-fill button.">
            You&apos;re on a phone, in a browser other than Chrome, or the extension isn&apos;t installed. Do Part 1, then refresh FlipLedger.
          </Faq>
          <Faq q="The site opened but nothing filled in.">
            Make sure you&apos;re logged in to that site in this Chrome, close the tab, and click Auto-fill again.
          </Faq>
          <Faq q="A field stayed empty or the category is wrong.">
            Fix it on the site before you press Publish. Sites change their forms now and then, so it can miss one.
          </Faq>
          <Faq q="I published but FlipLedger doesn't show it as listed.">
            Copy the listing&apos;s link from the site. In FlipLedger open the item → <b>Cross-list</b> → that marketplace, paste the link and
            tap <b>I listed it</b>. Sales are only spotted when the link is saved.
          </Faq>
        </dl>
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
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-2 pl-5 marker:font-bold">{children}</ol>
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-muted px-3 py-2 text-muted-foreground">{children}</p>
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-semibold">{q}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  )
}
