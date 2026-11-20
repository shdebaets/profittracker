import { PageTitle } from "@/components/app-header"
import { getIncoming, getOrders, getSettings } from "@/lib/data"
import { isOnTheWay } from "@/lib/incoming"
import { IncomingView } from "./incoming-view"
import { OrdersSwitch } from "./orders-switch"
import { OrdersView } from "./orders-view"

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const params = await searchParams
  if (params.view === "buying") {
    const [incoming, settings] = await Promise.all([getIncoming(), getSettings()])
    return (
      <>
        <PageTitle title="Orders" subtitle="Online orders on their way to you" />
        <OrdersSwitch view="buying" buyingCount={incoming.filter(isOnTheWay).length} />
        <IncomingView orders={incoming} defaultReturnDays={settings.default_return_days} />
      </>
    )
  }
  const [orders, incoming] = await Promise.all([getOrders(), getIncoming()])
  return <OrdersView orders={orders} switcher={<OrdersSwitch view="selling" buyingCount={incoming.filter(isOnTheWay).length} />} />
}
