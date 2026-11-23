#!/usr/bin/env node
// Regenerates every FlipLedger logo file from two sources in brand/:
//   brand/flipledger-logo-source.png  Nick's logo lockup (2172x724, Nov 2026), used for the wordmark
//   the icon below                    a vector rebuild of the icon in that PNG (the PNG's icon is
//                                     only ~388px and not square, too soft for 512px app icons)
// Run: node scripts/brand-assets.mjs   (uses sharp, which ships with Next.js)
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

const root = resolve(import.meta.dirname, "..")
const out = (p) => join(root, p)

// Icon artwork in a 388x388 box (viewBox origin 10,-2), traced from the source PNG.
const F_PATHS = [
  "M99 213 C108 180 122 140 140 118 C146 112 152 109 160 107 L336 75 C341 74 344 78 342 82 L318 132 C316 135 313 136 309 136 L210 156 C160 166 120 185 99 213 Z",
  "M66 315 C63 315 62 312 64 308 L92 247 C104 222 125 205 160 199 L294 169 C299 168 302 171 300 176 L286 221 C285 224 282 226 278 227 L190 247 C180 249 174 253 170 260 L150 300 C148 304 145 306 140 306 Z",
]

/** rounded: rounded-square corners (false = full square, for iOS and maskable icons, which the OS masks).
 *  scale: size of the F relative to the square (maskable icons keep it inside the safe zone). */
function iconSvg({ rounded = true, scale = 1 } = {}) {
  const cx = 204, cy = 192
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 -2 388 388">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#26272c"/><stop offset="0.5" stop-color="#0c0c0f"/><stop offset="1" stop-color="#060607"/>
    </linearGradient>
    <linearGradient id="f" gradientUnits="userSpaceOnUse" x1="330" y1="75" x2="80" y2="315">
      <stop offset="0" stop-color="#ffa43c"/><stop offset="0.45" stop-color="#ff8410"/><stop offset="1" stop-color="#ff5c00"/>
    </linearGradient>
  </defs>
  <rect x="10" y="-2" width="388" height="388" rx="${rounded ? 92 : 0}" fill="url(#bg)"/>
  <g fill="url(#f)" transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">
    ${F_PATHS.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>
</svg>
`
}

const png = (svg, size) => sharp(Buffer.from(svg), { density: Math.max(72, (72 * size) / 388 * 2) }).resize(size, size).png()

/** ICO file holding PNG images (supported by every browser since IE Vista era). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, e); header.writeUInt8(size >= 256 ? 0 : size, e + 1)
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8); header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images.map((i) => i.data)])
}

// Wordmark: crop "FlipLedger" from the source and make the near-white background transparent.
// light = as designed (black "Flip"); dark = white "Flip", for dark backgrounds.
async function wordmarks() {
  const BG = 254 // the source background is #fefefe
  const box = { left: 692, top: 254, width: 1262, height: 244 } // text bounds 696..1950 x 258..493, plus 4px
  const LEDGER_X = 1110 - box.left // "Ledger" starts here; everything left of it is the black "Flip"
  const { data, info } = await sharp(join(root, "brand/flipledger-logo-source.png"))
    .extract(box).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const light = Buffer.alloc(info.width * info.height * 4)
  const dark = Buffer.alloc(info.width * info.height * 4)
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const s = (y * info.width + x) * 3, d = (y * info.width + x) * 4
      const [r, g, b] = [data[s], data[s + 1], data[s + 2]]
      const a = Math.max(0, Math.min(1, (BG - Math.min(r, g, b)) / BG))
      // Un-blend from white so anti-aliased edges keep the right colour on any background.
      const un = (c) => (a < 0.02 ? 0 : Math.max(0, Math.min(255, Math.round((c - (1 - a) * BG) / a))))
      const rgb = [un(r), un(g), un(b)]
      const alpha = a < 0.02 ? 0 : Math.round(a * 255)
      light.set([...rgb, alpha], d)
      dark.set(x < LEDGER_X ? [255, 255, 255, alpha] : [...rgb, alpha], d)
    }
  }
  const raw = { raw: { width: info.width, height: info.height, channels: 4 } }
  // 2x of a 48px-tall display is ~96px; keep 160px for crisp large uses (login, OG image).
  const toPng = (buf, height = 160) =>
    sharp(buf, raw).resize({ height }).png({ compressionLevel: 9, palette: true, quality: 95 }).toBuffer()
  return { light: await toPng(light), dark: await toPng(dark), darkSmall: await toPng(dark, 96) }
}

mkdirSync(out("public/brand"), { recursive: true })
const rounded = iconSvg()
writeFileSync(out("brand/icon.svg"), rounded)
writeFileSync(out("app/icon.svg"), rounded)
writeFileSync(out("public/brand/icon.svg"), rounded)

await png(rounded, 64).toFile(out("app/icon.png"))
await png(rounded, 192).toFile(out("public/icons/icon-192.png"))
await png(rounded, 512).toFile(out("public/icons/icon-512.png"))
const apple = await png(iconSvg({ rounded: false }), 180).flatten({ background: "#060607" }).toBuffer()
writeFileSync(out("public/icons/apple-touch-icon.png"), apple)
writeFileSync(out("app/apple-icon.png"), apple)
await png(iconSvg({ rounded: false, scale: 0.78 }), 512).toFile(out("public/icons/maskable-512.png"))
for (const s of [16, 32, 48, 128]) await png(rounded, s).toFile(out(`extension/icons/icon-${s}.png`))
writeFileSync(
  out("app/favicon.ico"),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size).toBuffer() })))),
)

const wm = await wordmarks()
writeFileSync(out("public/brand/wordmark-light.png"), wm.light)
writeFileSync(out("public/brand/wordmark-dark.png"), wm.dark)

// Server-rendered images (the win card) can't count on public/ being on disk in a Vercel function,
// so they get the artwork inlined as data URIs.
const dataUri = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString("base64")}`
const darkMeta = await sharp(wm.darkSmall).metadata()
writeFileSync(
  out("lib/brand-images.ts"),
  `// Generated by scripts/brand-assets.mjs. Do not edit by hand.
export const ICON_DATA_URI = ${JSON.stringify(dataUri("image/svg+xml", rounded))}
/** "FlipLedger" wordmark for dark backgrounds, ${darkMeta.width}x${darkMeta.height}. */
export const WORDMARK_DARK_DATA_URI = ${JSON.stringify(dataUri("image/png", wm.darkSmall))}
export const WORDMARK_ASPECT = ${(darkMeta.width / darkMeta.height).toFixed(4)}
`,
)

// Open Graph / link-preview image: icon + wordmark on white, 1200x630.
const ogIcon = await png(rounded, 200).toBuffer()
const ogWord = await sharp(wm.light).resize({ height: 104 }).toBuffer()
const ogWordMeta = await sharp(ogWord).metadata()
const gap = 40, total = 200 + gap + ogWordMeta.width
const left = Math.round((1200 - total) / 2)
await sharp({ create: { width: 1200, height: 630, channels: 4, background: "#ffffff" } })
  .composite([
    { input: ogIcon, left, top: 215 },
    { input: ogWord, left: left + 200 + gap, top: Math.round(315 - ogWordMeta.height / 2) },
  ])
  .png()
  .toFile(out("app/opengraph-image.png"))

console.log("brand assets written")
