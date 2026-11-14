function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ""
  const headers = Object.keys(rows[0])
  return [headers.join(","), ...rows.map((r) => headers.map((h) => cell(r[h])).join(","))].join("\n")
}

export async function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  await shareOrDownload(new Blob([toCsv(rows)], { type: "text/csv" }), filename)
}

/** Share on mobile when supported (the installed iOS app can't download), otherwise download. */
export async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch {
      // user cancelled or share failed; fall back to download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const dollars = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2))
