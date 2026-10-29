/** A producer whose phone on file matches an incoming caller id (POST /api/calling/match). */
export interface IncomingCallMatch {
  customerId: number;
  name: string;
  /** Who at the producer the number belongs to, when it is one of the contacts originators add on the
   *  producer details card (e.g. "Jane Smith"). Absent when it matched the producer's own phone. */
  contactName?: string | null;
  /** Every added contact carrying the number (primary first); contactName is the first. */
  contactNames?: string[];
  /** The customer code shown to users. */
  scoularId?: string | null;
  location?: string | null;
  stateProvince?: string | null;
  /** First active trade unit, or null when the producer has no membership rows. */
  tradeUnit?: string | null;
  tradeUnits: string[];
}

/** ACS token for the signed-in user's own Teams identity (GET /api/calling/token). */
export interface CallingToken {
  token: string;
  expiresOn: string;
}

/**
 * Where the incoming-call popup is.
 * - `unavailable`: calling is off in this environment (token endpoint answered 204) or the SDK
 *   failed to start. Terminal for the session; the popup never shows.
 * - `answeredElsewhere`: the user picked up on another Teams endpoint (desktop / mobile). The popup
 *   collapses to a banner that still offers the producer link.
 */
export type IncomingCallState =
  | 'idle'
  | 'unavailable'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'held'
  | 'answeredElsewhere'
  | 'ended';
