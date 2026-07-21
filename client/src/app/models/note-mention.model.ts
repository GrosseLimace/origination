export type NoteMentionType = 'person' | 'trade-unit' | 'trade-unit-group';

/** A single "@" mention saved with a note. Mirrors the backend NoteMention record. */
export interface NoteMention {
  type: NoteMentionType;
  id: string;        // UPN prefix (person) | TU code | TU-group id
  name: string;      // display label
  email?: string;    // only for person; TU/group resolved at send time
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

export interface MentionCatalogGroup {
  groupId: number;
  name: string;
}

export interface MentionCatalog {
  people: MentionCatalogPerson[];
  tradeUnits: MentionCatalogTradeUnit[];
  groups: MentionCatalogGroup[];
}
