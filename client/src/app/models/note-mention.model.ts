export type NoteMentionType = 'person' | 'trade-unit' | 'trade-unit-group' | 'app-group';

/** A single "@" mention saved with a note. Mirrors the backend NoteMention record. */
export interface NoteMention {
  type: NoteMentionType;
  id: string;        // UPN prefix (person) | TU code | TU-group id | group id
  name: string;      // display label
  email?: string;    // only for person; TU/group resolved at send time
  /** Server-set provenance ("app-group:7") on rows the API flattened out of a group. Absent on
   *  mentions the user picked directly. These rows are recipients only — they must be excluded
   *  when building "@name" highlight tokens, or a group member's name would light up text the
   *  author never typed. */
  via?: string;
}

/** Lookup data for the "@" mention picker (GET /notes/mention-catalog). */
export interface MentionCatalogPerson {
  userId: string;
  displayName: string;
  email: string;
}

export interface MentionCatalogTradeUnit {
  code: string;
  description?: string;
}

/** An IT-managed trade-unit group from entitlements. */
export interface MentionCatalogGroup {
  groupId: number;
  name: string;
}

/** One of the user's own groups — mentioning it shares the note with everyone in it. */
export interface MentionCatalogAppGroup {
  groupId: number;
  name: string;
  /** Member references, not a head count: a trade-unit member counts as one here but resolves to
   *  everyone in that trade unit when the note is sent. */
  memberCount: number;
  isOwner: boolean;
}

export interface MentionCatalog {
  people: MentionCatalogPerson[];
  tradeUnits: MentionCatalogTradeUnit[];
  tradeUnitGroups: MentionCatalogGroup[];
  /** Optional: the API gathers these from a different database and omits them if it's unreachable,
   *  so the picker simply offers no groups rather than breaking. */
  appGroups?: MentionCatalogAppGroup[];
}
