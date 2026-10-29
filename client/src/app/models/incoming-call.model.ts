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
 */
/** Another call shown as a row under the main card: one waiting to be answered, or one on hold. */
export interface IncomingCallSummary {
  seq: number;
  state: IncomingCallState;
  /** E.164, or null when the caller is not a phone number (then `displayName`). */
  callerNumber: string | null;
  displayName: string | null;
  /** The producer it is about (the only match, or the one picked), if known. */
  match: IncomingCallMatch | null;
  matchCount: number;
  matchesLoading: boolean;
  /** Epoch ms the call first connected (null while it has only rung). */
  connectedSince: number | null;
}

export type IncomingCallState =
  | 'idle'
  | 'unavailable'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'held'
  | 'ended';
