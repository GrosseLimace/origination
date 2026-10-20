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
  /** True when the API could not read the catalog and the lists are empty because of that, not
   *  because there is nobody to offer. The call still succeeds; show a notice rather than silence. */
  degraded?: boolean;
  people: EntitlementPerson[];
  tradeUnits: EntitlementTradeUnit[];
  groups: EntitlementTradeUnitGroup[];
}
