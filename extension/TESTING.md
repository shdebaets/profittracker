# Testing the extension on the real sites

A checklist for someone with real Facebook Marketplace, Poshmark and Mercari seller accounts. It takes about 30 to 45 minutes. Everything happens on one fake test item, which you delete at the end.

**Already checked without an account (Nov 17, 2026):** sale detection reads today's live, sold and deleted Poshmark and Mercari pages correctly, and the Poshmark closet import reads closets of up to 1,744 listings. The steps below cover what needs a logged-in seller.

## Before you start

1. Use desktop Chrome on a computer, not a phone.
2. Install the extension. Open `chrome://extensions` and check that **FlipLedger Lister** shows version **0.13.0** or newer. If it's older, remove it, unzip the `flipledger-extension-0.13.0.zip` you were sent, turn on **Developer mode** (top right), click **Load unpacked** and pick the unzipped folder.
3. In that same Chrome, log in to Facebook, Poshmark and Mercari, and to FlipLedger (profit.emoneydeals.com).
4. In FlipLedger, open **Settings**. "Add to Chrome" should be gone, and **Import from Mercari** should be clickable. If not, reload the page.
5. Leave **Publish automatically** and **Delist automatically** off for now.

## 1. Make the test item

In FlipLedger, tap **+**, then add an inventory item:

- Title: `TEST LISTING - DO NOT BUY - Nike Hoodie Men's L`
- Cost: $1. Price: **$999**, so nobody buys it.
- 2 photos of anything (a hoodie works best for the category guess).
- Brand: Nike. Size: L. Condition: Good.

## 2. Auto-fill and publish (do each site in turn)

Open the item, tap **Cross-list**, then **Auto-fill on <site>**. A new tab opens and a FlipLedger panel appears on the site's form.

For each site, write down:

- [ ] Did the photos upload?
- [ ] Were title, description, price, brand, size and condition filled in correctly?
- [ ] Which category did it pick, and was it right?
- [ ] What does the panel list under **Your turn** (things it couldn't fill)?

Finish anything it left (Poshmark: original price; Mercari: shipping), then click the site's **Publish** / **List** button yourself.

- [ ] Back in FlipLedger, does the item show as **Listed on** that site, with a working link to the listing?

Then try auto-publish once: turn on **Publish automatically** in Settings, make a second test item, Auto-fill it on one site, and check whether it publishes after the 5-second countdown. Turn it off again afterwards, and delete that second listing on the site.

## 3. Edit once, update everywhere

Change the test item's price to **$990** and add " v2" to the title in FlipLedger.

- [ ] Do the Facebook, Poshmark and Mercari listings show **Update <site>** in the Cross-list panel?
- [ ] Click each one. Did the site's edit form open with the new price and title already filled in? Save it yourself.
- [ ] After saving, does FlipLedger show the listing as synced (no ↻ badge)?

## 4. Smart Offers (Poshmark and Mercari only)

This only works if someone has liked the test listing. Like it from a second account if you have one; otherwise skip this section.

In **Settings → Smart Offers**, set "Only after" to 0 days and save. The listing should appear in the list below.

- [ ] Click **Fill offer**. Does it open the listing's offer-to-likers form with the price filled in? Send it yourself, then click **I sent it**.

## 5. Delist after a sale

Mark the test item **Sold** in FlipLedger (any price). The Facebook, Poshmark and Mercari listings should now show up in the **Delist these listings** banner.

1. **By hand first:** click the wand button next to one site.
   - [ ] Does it open the listing and highlight the right button?
   - [ ] After you remove the listing, does FlipLedger mark it ended?
2. **Then automatically:** turn on **Delist automatically** in Settings and leave FlipLedger open for a minute.
   - [ ] Did the remaining listings get removed in background tabs?
   - [ ] Are they gone from the delist banner?
   - [ ] Are they actually gone on each site? Check on the site itself.

Turn **Delist automatically** off again if you don't want it on for real.

## 6. Sale detection on a real sale (optional)

Only if you sell something real on Poshmark or Mercari that's also tracked in FlipLedger with its listing link saved: within about 5 minutes of opening FlipLedger on the computer, it should record the sale and put the other sites' listings on the delist list.

## Clean up

Delete every test listing on each site, then delete the test items in FlipLedger.

## What to send back

For each site, send which checkboxes failed and a screenshot of the FlipLedger panel on that site's form, especially the **Your turn** list. If something errors, a screenshot of the error is enough.
