import { getResearchList } from "@/lib/research/data"
import { ResearchView } from "./research-view"

export default async function ResearchPage({ searchParams }: PageProps<"/research">) {
  const [list, params] = await Promise.all([getResearchList(), searchParams])
  const q = typeof params.q === "string" ? params.q : ""
  return <ResearchView list={list} initialQuery={q} />
}
