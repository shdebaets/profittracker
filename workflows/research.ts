// Research workflows (Vercel Workflow): durable, resumable runs that need no open page
// and no minute-level cron. Each loop iteration is one bounded step.
import * as step from "./research-steps"

const BUDGET_NOTE = "Paused: today's eBay API budget is nearly used. It continues tomorrow."

/** Live listings: search every keyword, match with rules + AI, then fetch listing details. */
export async function trackProduct(productId: string, runId: string) {
  "use workflow"
  try {
    const keywords = await step.loadKeywords(productId)
    const variants: { keyword: string; reported: number; pages: number; unique: number; offset: number; done: boolean }[] = []
    for (const keyword of keywords) {
      if (!(await step.runActive(runId))) return { stopped: true }
      const r = await step.searchKeyword(productId, runId, keyword)
      if (!r.ok) {
        await step.finishRun(runId, productId, "track", "paused", BUDGET_NOTE)
        return { paused: true }
      }
      variants.push({ ...r.value, offset: r.value.pages * 200, done: true })
      await step.setRun(runId, { step: "search", progress: { variants, search: { done: variants.length, total: keywords.length } } })
    }
    let pending = await step.finishSearch(productId, runId)
    const toJudge = pending
    await step.setRun(runId, { step: "judge", progress: { toJudge, judged: 0 } })
    while (pending > 0) {
      if (!(await step.runActive(runId))) return { stopped: true }
      pending = await step.judgeListings(productId)
      await step.setRun(runId, { progress: { toJudge, judged: Math.max(0, toJudge - pending) } })
    }
    await step.priceGuard(productId)
    await step.setRun(runId, { step: "details", progress: { phase1Done: true } })
    for (;;) {
      if (!(await step.runActive(runId))) return { stopped: true }
      const r = await step.detailsChunk(productId)
      if (!r.ok) {
        await step.finishRun(runId, productId, "track", "paused", BUDGET_NOTE)
        return { paused: true }
      }
      await step.setRun(runId, { progress: { details: { done: r.value.total - r.value.left, total: r.value.total } } })
      if (!r.value.left) break
    }
    await step.priceGuard(productId)
    await step.finishRun(runId, productId, "track", "done", null)
    return { done: true }
  } catch (e) {
    await step.finishRun(runId, productId, "track", "error", "This refresh failed. Tap Refresh to try again.")
    throw e
  }
}

/** Sold history uploaded by the extension: match, price-guard, then fetch units sold per listing. */
export async function matchSoldHistory(productId: string, runId: string) {
  "use workflow"
  try {
    await step.setRun(runId, { step: "judge" })
    while ((await step.soldJudgeChunk(productId)) > 0) {
      if (!(await step.runActive(runId))) return { stopped: true }
      await step.setRun(runId, { progress: await step.soldSummary(productId) })
    }
    await step.soldGuard(productId)
    await step.setRun(runId, { step: "details", progress: await step.soldSummary(productId) })
    for (;;) {
      if (!(await step.runActive(runId))) return { stopped: true }
      const r = await step.soldDetailsChunk(productId)
      if (!r.ok) {
        await step.finishRun(runId, productId, "sold", "paused", BUDGET_NOTE)
        return { paused: true }
      }
      await step.setRun(runId, { progress: await step.soldSummary(productId) })
      if (!r.value) break
    }
    await step.soldGuard(productId)
    await step.setRun(runId, { progress: await step.soldSummary(productId) })
    await step.finishRun(runId, productId, "sold", "done", null)
    return { done: true }
  } catch (e) {
    await step.finishRun(runId, productId, "sold", "error", "Matching sold history failed. Pull it again to retry.")
    throw e
  }
}
