# FlipLedger phone app

A thin Capacitor app around the live site (https://profit.emoneydeals.com). Everything else is the
normal web app; the one native extra is an **eBay window** (`@capgo/inappbrowser`) that reads eBay
sold searches signed in as the member, the same way the Chrome extension does on desktop
(`lib/native-ebay.ts`, `lib/sold-browser.ts`). With it, comps on phones cost nothing (no paid
sold-data requests).

## How a lookup works in the app

1. The member comps an item. The app opens eBay's sold search for it in a hidden eBay window.
2. `collectSoldPage` (`lib/comps/collect-sold.ts`) reads the sold cards and eBay's result count and
   sends them back. One eBay page per product, at most once every 12 hours, shared with everyone.
3. If eBay wants a sign-in or a captcha, the window slides up so the member can finish it. The
   eBay sign-in is kept, so this is usually once.

## Build (needs a Mac for iOS)

```bash
cd mobile
npm install
npx cap add ios        # first time only
npx cap add android    # first time only
npx cap sync
npx cap open ios       # Xcode: set the team, then Run / Archive
npx cap open android   # Android Studio: Run / Build > Generate Signed Bundle
```

Accounts: Apple Developer Program ($99/year) and Google Play Console ($25 once).

## Native settings to add after `cap add`

- iOS `Info.plist`: `NSCameraUsageDescription` = "Scan barcodes to look up what items sell for."
- Android: camera permission for barcode scanning (`android.permission.CAMERA`).

## Known limits

- Web push doesn't run inside the app's web view. Recap emails still go out; native push would
  need `@capacitor/push-notifications` plus APNs/FCM keys.
- Reading eBay pages is against eBay's user agreement for automated access. Keep it to one page
  per lookup at the member's own pace, never in the background on a loop.
- App Store review: describe the eBay window as "look up sold prices on eBay while signed in to
  your own account". Sign in with Whop happens in the app (allowNavigation lists whop.com).
