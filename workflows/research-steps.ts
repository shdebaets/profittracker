// Durable steps of the research workflows. Each step is retried on failure (3 times by
// default) and its result is recorded, so a run survives timeouts and redeploys.
// The pipeline is imported here (not in the workflow file) so database and eBay code
// stays out of the workflow sandbox bundle.
import * as pipeline from "@/lib/research/pipeline"

type Outcome<T> = { ok: true; value: T } | { ok: false; budget: true }

/** Budget pauses are an expected outcome, not a failure to retry. */
async function guard<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    if (e instanceof pipeline.BudgetError) return { ok: false, budget: true }
    throw e
  }
}

export async function loadKeywords(productId: string) {
  "use step"
  const product = await pipeline.getProduct(productId)
  return (product.profile.keywords ?? []).filter(Boolean)
}

export async function runActive(runId: string) {
  "use step"
  return pipeline.runActive(runId)
}

export async function setRun(runId: string, patch: Parameters<typeof pipeline.updateRun>[1]) {
  "use step"
  await pipeline.updateRun(runId, patch)
}

export async function searchKeyword(productId: string, runId: string, keyword: string) {
  "use step"
  return guard(() => pipeline.searchKeyword(productId, runId, keyword))
}

export async function finishSearch(productId: string, runId: string) {
  "use step"
  return pipeline.finishSearch(productId, runId)
}

export async function judgeListings(productId: string) {
  "use step"
  return pipeline.judgeListings(productId)
}

export async function priceGuard(productId: string) {
  "use step"
  await pipeline.priceGuard(productId)
}

export async function detailsChunk(productId: string) {
  "use step"
  return guard(() => pipeline.detailsChunk(productId))
}

export async function soldJudgeChunk(productId: string) {
  "use step"
  return pipeline.soldJudgeChunk(productId)
}

export async function soldGuard(productId: string) {
  "use step"
  await pipeline.soldGuard(productId)
}

export async function soldDetailsChunk(productId: string) {
  "use step"
  return guard(() => pipeline.soldDetailsChunk(productId))
}

export async function soldSummary(productId: string) {
  "use step"
  return pipeline.soldSummary(productId)
}

export async function finishRun(runId: string, productId: string, kind: "track" | "sold", status: "done" | "paused" | "error", message: string | null) {
  "use step"
  await pipeline.finishRun(runId, productId, kind, status, message)
}
