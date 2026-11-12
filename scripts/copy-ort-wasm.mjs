// Copies onnxruntime-web's WebAssembly (and its JS loader) into public/ so the background remover
// (lib/background.ts) loads it from our own origin. The folder is versioned so
// it can be cached forever; it's gitignored and rebuilt on every install.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = join(root, "node_modules/onnxruntime-web")
if (!existsSync(pkg)) process.exit(0)
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"))
const out = join(root, "public/models/ort", version)
mkdirSync(out, { recursive: true })
for (const file of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
  if (!existsSync(join(out, file))) copyFileSync(join(pkg, "dist", file), join(out, file))
}
