import { notFound } from "next/navigation"
import { getResearchItem } from "@/lib/research/data"
import { ItemView } from "./item-view"

export default async function ResearchItemPage({ params }: PageProps<"/research/[id]">) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const item = await getResearchItem(id)
  if (!item) notFound()
  return <ItemView item={item} />
}
