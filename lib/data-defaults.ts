import { DEFAULT_TAX_BRACKET } from "@/lib/tax"
import type { Settings } from "@/lib/types"

export const DEFAULT_SETTINGS: Settings = {
  mileage_rate_cents: 76,
  default_return_days: 90,
  tax_bracket: DEFAULT_TAX_BRACKET,
  tax_bracket_set: false,
  stale_days: 60,
  email_recap: true,
  email_tax_reminders: true,
}
