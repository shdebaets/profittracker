import { getOrders } from "@/lib/data"
import { OrdersView } from "./orders-view"

export default async function OrdersPage() {
  const orders = await getOrders()
  return <OrdersView orders={orders} />
}
