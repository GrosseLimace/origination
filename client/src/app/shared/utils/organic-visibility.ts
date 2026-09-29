/**
 * Decides whether the organic section shows on a producer profile.
 *
 * Two PRODUCER-level conditions, OR'd — the viewer's trade unit is deliberately not part of this.
 * An earlier design gated on whether the person looking was on the organics desk; that was dropped
 * because the useful signal is the producer, not the viewer.
 *
 *   1. The producer carries CTRM industry code 'OR'.
 *   2. The producer has a real NOP id on file.
 *
 * Why both, when they overlap almost completely: measured against Dev on 2026-09-21, 566 producers
 * carry the 'OR' code and 570 have a real NOP id, but they are not the same set. Five producers in
 * trade unit 2080 — the organics desk's own — hold real NOP ids while being coded 'CV' (conventional)
 * or 'DA' (dairy) in CTRM. Without condition 2 those five would show nothing. One producer has the
 * code but no usable id, and shows via condition 1. The union is 571.
 *
 * Note what is NOT checked here: industry code slot 1. `originations.vw_CustomerTradeUnits` filters
 * on `IndustryCode1 = 'PR'`, and the manual-onboarding path filters identically, so every customer
 * the app can see is already a producer by construction. That is an invariant enforced by a view we
 * own — if that WHERE clause is ever relaxed, this gate widens silently and nothing here will fail.
 */

/** The organic code in CTRM industry slot 2. */
const ORGANIC_INDUSTRY_CODE = 'OR';

/** The producer facts this decision reads. Deliberately narrow so callers can't widen it casually. */
export interface OrganicVisibilitySubject {
  /** CTRM industry code slot 2. */
  industryCode2?: string | null;
  /** Real 10-digit NOP id, normalised server-side. Placeholders never arrive here. */
  nopId?: string | null;
}

/** Which conditions fired. Reported rather than collapsed so specs — and a dev-mode log — can
 *  answer "why is this showing?" without a debugger. */
export type OrganicVisibilityReason = 'industry-code' | 'nop-id';

/** Individually switchable so either condition can be retired without touching call sites. */
export interface OrganicVisibilityRules {
  industryCode: boolean;
  nopId: boolean;
}

export const ORGANIC_VISIBILITY_RULES: OrganicVisibilityRules = {
  industryCode: true,
  nopId: true,
};

/** True when the producer carries the organic industry code. Exact match after trim/upper —
 *  never a substring, or 'ORG' and 'FOR' would both qualify. */
export function hasOrganicIndustryCode(subject: OrganicVisibilitySubject): boolean {
  return subject.industryCode2?.trim().toUpperCase() === ORGANIC_INDUSTRY_CODE;
}

/** True when a real NOP id is on file. The server has already rejected placeholders, so presence
 *  is enough — but guard against an empty string arriving anyway. */
export function hasOrganicNopId(subject: OrganicVisibilitySubject): boolean {
  return !!subject.nopId?.trim();
}

/** Whether the organic section shows, and which conditions put it there. */
export function organicVisibility(
  subject: OrganicVisibilitySubject,
  rules: OrganicVisibilityRules = ORGANIC_VISIBILITY_RULES
): { visible: boolean; reasons: OrganicVisibilityReason[] } {
  const reasons: OrganicVisibilityReason[] = [];
  if (rules.industryCode && hasOrganicIndustryCode(subject)) reasons.push('industry-code');
  if (rules.nopId && hasOrganicNopId(subject)) reasons.push('nop-id');
  return { visible: reasons.length > 0, reasons };
}

/** The boolean the template binds to. */
export function isOrganicSectionVisible(
  subject: OrganicVisibilitySubject,
  rules: OrganicVisibilityRules = ORGANIC_VISIBILITY_RULES
): boolean {
  return organicVisibility(subject, rules).visible;
}
