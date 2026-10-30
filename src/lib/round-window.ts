// A validated planned snapshot becomes orderable at its opening time, even if
// the scheduler's next tick is delayed. Cancelled/blocked/sent rounds never do.
export function roundWindowStatus(
  round: { status: string; opens: number; closes: number },
  now: number,
) {
  if (!['planned', 'open'].includes(round.status) || now >= round.closes) return 'closed';
  return now < round.opens ? 'upcoming' : 'open';
}
