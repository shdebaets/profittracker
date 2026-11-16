// Which column of someone else's spreadsheet holds which FlipLedger field. Guessed from
// header names (every tracker names them differently); the seller can fix any guess.

export type ImportKind = "items" | "expenses"

export type FieldDef<K extends string = string> = { key: K; label: string; hint?: string; synonyms: string[] }

export const ITEM_FIELDS = [
  { key: "title", label: "Item name", synonyms: ["title", "item", "item name", "item title", "name", "product", "product name", "listing title", "description"] },
  { key: "quantity", label: "Quantity", hint: "Blank means 1", synonyms: ["quantity", "qty", "units", "count", "unit count"] },
  { key: "cost", label: "Cost per item", hint: "What you paid for one", synonyms: ["unit cost", "cost", "cogs", "cost of goods", "purchase price", "price paid", "paid", "buy price", "bought for", "item cost", "cost per item", "cost each", "cost per unit"] },
  { key: "totalCost", label: "Total cost", hint: "Used when there's no per-item cost", synonyms: ["total cost", "total paid", "total purchase price", "total cogs"] },
  { key: "purchasedAt", label: "Purchase date", synonyms: ["purchase date", "purchased", "purchased at", "date purchased", "bought", "buy date", "date bought", "acquired", "date acquired", "sourced date", "date sourced", "date added", "added"] },
  { key: "store", label: "Store / source", synonyms: ["store", "source", "sourced from", "where purchased", "purchased from", "where bought", "supplier", "vendor", "sourcing location"] },
  { key: "soldAt", label: "Sold date", synonyms: ["sold date", "date sold", "sale date", "sold at", "sold on date", "sold"] },
  { key: "salePrice", label: "Sale price per item", synonyms: ["sale price", "sold price", "sold for", "selling price", "price sold", "unit sale price", "sale amount", "item price sold"] },
  { key: "saleTotal", label: "Total sale", hint: "Used when there's no per-item price", synonyms: ["total sale", "revenue", "gross", "gross sale", "gross sales", "total sold", "order total", "sale total", "total sale price"] },
  { key: "buyerShipping", label: "Shipping the buyer paid", synonyms: ["buyer shipping", "shipping charged", "shipping paid by buyer", "shipping income", "shipping collected"] },
  { key: "fees", label: "Selling fees ($)", hint: "Their real fees. Blank uses the platform's usual rate", synonyms: ["fees", "fee", "platform fee", "platform fees", "selling fees", "selling fee", "marketplace fee", "marketplace fees", "transaction fees", "total fees", "ebay fees"] },
  { key: "labelCost", label: "Shipping label cost", synonyms: ["label cost", "shipping cost", "shipping", "postage", "label", "ship cost", "shipping expense", "shipping label"] },
  { key: "platform", label: "Sold on (platform)", synonyms: ["platform", "marketplace", "sold on", "channel", "site", "sold where", "where sold", "venue", "sold via"] },
  { key: "status", label: "Status", hint: "Sold, in stock, returned", synonyms: ["status", "sold?", "is sold", "state", "item status"] },
  { key: "listPrice", label: "List price", synonyms: ["list price", "listing price", "asking price", "price", "listed price", "listed at"] },
  { key: "salesTax", label: "Sales tax collected", synonyms: ["sales tax", "tax collected", "tax"] },
  { key: "link", label: "Link", synonyms: ["link", "url", "listing url", "listing link"] },
  { key: "notes", label: "Notes", synonyms: ["notes", "note", "description", "comments", "details"] },
  { key: "brand", label: "Brand", synonyms: ["brand", "make", "manufacturer"] },
  { key: "size", label: "Size", synonyms: ["size"] },
  { key: "category", label: "Category", synonyms: ["category", "type", "item type", "department"] },
] as const satisfies FieldDef[]

export const EXPENSE_FIELDS = [
  { key: "title", label: "Description", synonyms: ["description", "title", "item", "expense", "name", "memo", "note", "notes", "details", "merchant", "payee", "vendor", "what"] },
  { key: "amount", label: "Amount", hint: "Blank for mileage rows", synonyms: ["amount", "cost", "total", "price", "spent", "debit", "expense amount", "amount spent"] },
  { key: "date", label: "Date", synonyms: ["date", "spent", "spent at", "purchase date", "transaction date", "expense date", "paid on", "date paid"] },
  { key: "category", label: "Category", synonyms: ["category", "type", "expense type", "expense category"] },
  { key: "miles", label: "Miles", hint: "Rows with miles and no amount become mileage at your rate", synonyms: ["miles", "mileage", "distance", "miles driven"] },
] as const satisfies FieldDef[]

export type ItemField = (typeof ITEM_FIELDS)[number]["key"]
export type ExpenseField = (typeof EXPENSE_FIELDS)[number]["key"]

/** Field → column index, or -1 when the sheet has no such column. */
export type Mapping<K extends string> = Record<K, number>

const norm = (h: string) => ` ${h.toLowerCase().replace(/[_\-./()#]+/g, " ").replace(/[^a-z0-9?% ]+/g, "").replace(/\s+/g, " ").trim()} `

/**
 * Best guess for every field. Exact header matches beat partial ones ("Unit Cost" is the
 * cost, not "Cost Missing"), and each column goes to one field at most.
 */
export function guessMapping<K extends string>(fields: readonly FieldDef<K>[], headers: string[]): Mapping<K> {
  const cands: { field: K; col: number; score: number }[] = []
  fields.forEach((f, fi) => {
    headers.forEach((h, col) => {
      const head = norm(h)
      f.synonyms.forEach((syn, si) => {
        const s = ` ${syn} `
        const exact = head === s
        if (!exact && !head.includes(s)) return
        // Exact first, then longer synonyms, then the field's own synonym order, then field order.
        cands.push({ field: f.key, col, score: (exact ? 1e6 : 0) + syn.length * 1e3 - si * 10 - fi / 100 })
      })
    })
  })
  cands.sort((a, b) => b.score - a.score)
  const mapping = Object.fromEntries(fields.map((f) => [f.key, -1])) as Mapping<K>
  const taken = new Set<number>()
  for (const c of cands) {
    if (mapping[c.field] >= 0 || taken.has(c.col)) continue
    mapping[c.field] = c.col
    taken.add(c.col)
  }
  // A lone "Description" column is the item's name, not notes.
  const m = mapping as Record<string, number>
  if ("notes" in m && m.title < 0 && m.notes >= 0) {
    m.title = m.notes
    m.notes = -1
  }
  return mapping
}
