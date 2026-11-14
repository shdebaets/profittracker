// Push copy for leaderboard badges. Pure. (Kept apart from messages.ts.)
import { BOARD_LABEL, monthLabel, type Badge } from "@/lib/leaderboard"

export function badgePush(b: Badge) {
  const medal = b.place === 1 ? "🥇" : b.place === 2 ? "🥈" : "🥉"
  return {
    title: `${medal} #${b.place} in ${BOARD_LABEL[b.board]}`,
    body: `You finished #${b.place} on the ${monthLabel(b)} ${BOARD_LABEL[b.board].toLowerCase()} leaderboard. Your badge is on your win card.`,
    url: "/leaderboard",
    tag: `badge-${b.year}-${b.month}-${b.board}`,
  }
}
