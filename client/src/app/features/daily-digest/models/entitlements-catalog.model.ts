/**
 * Shape returned by GET /api/entitlements/catalog — fed to the Recap Group
 * picker so users can choose recipients from the live entitlements directory
 * rather than a hardcoded list.
 *
 * One catalog covers all three picker tabs (People / Trade Units / Groups);
 * the dialog fetches it once when it opens.
 */
export interface EntitlementPerson {
  userId: string;       // UPN prefix (e.g. "CEgr")
  displayName: string;  // "Caden Egr"
  email: string;        // Conventionally <userId>@scoular.com — Logic App resolves authoritatively at send time.
  tradeUnitCodes: string[]; // TUs this person belongs to — drives cascade-select from a TU/group.
}

export interface EntitlementTradeUnit {
  code: string;
  description?: string | null;
}

export interface EntitlementTradeUnitGroup {
  groupId: number;
  name: string;
  tradeUnitCodes: string[];
}

export interface EntitlementsCatalog {
  people: EntitlementPerson[];
  tradeUnits: EntitlementTradeUnit[];
  groups: EntitlementTradeUnitGroup[];
}
