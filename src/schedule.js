import { MILESTONES } from './calculations.js';
import { medicalHold } from './safety.js';
import { DAY, nextReport } from './time.js';

export function slotFor(state, now, afterDay = null) {
  const p = state.profile;
  const period = state.intervals.at(-1);
  if (!p || medicalHold(p) || p.frequency === 'off' || period?.end !== null) return null;
  if (p.frequency === 'milestones') {
    if (state.neutral) return null;
    const due = MILESTONES.map(d => period.start + d * DAY).find(ms => ms > now);
    if (!due) return null;
    return nextReport(due - 1, p, afterDay);
  }
  return nextReport(Math.max(now, period.start - 1), p, afterDay);
}
