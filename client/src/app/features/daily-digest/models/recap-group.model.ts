/**
 * Daily Digest configuration models. Defines a user-built "Recap Group" — a set
 * of recipients (people / trade units / trade-unit groups) plus optional CC
 * addresses, scheduled to receive a daily recap of producer notes.
 *
 * Storage / sending lives in the external Logic App; this app only owns the
 * configuration. Members are resolved from the entitlements service at the
 * picker / save layer — `id` here is the entitlements identifier (UPN for
 * People, code for TradeUnit, name for TradeUnitGroup).
 */

export type DeliveryMethod = 'email' | 'teams';

export type MemberType = 'person' | 'trade-unit' | 'trade-unit-group';

export interface RecapMember {
  /** Entitlements identifier. UPN for `person`, TU code for `trade-unit`, group name for `trade-unit-group`. */
  id: string;
  name: string;
  type: MemberType;
  /** Populated only for `person` members — Logic App uses this directly as the recipient email. */
  email?: string;
}

export interface RecapGroup {
  /** App-assigned id. Will become a DB PK when persistence lands. */
  id: string;
  name: string;
  deliveryMethod: DeliveryMethod;
  members: RecapMember[];
  /** Extra email addresses on top of the resolved member recipients. */
  ccList: string[];
  /** Microsoft Teams channel email — populated only when deliveryMethod is 'teams'.
   *  The Logic App posts the recap to this channel address. */
  teamsChannelEmail?: string;
  enabled: boolean;
  /** True when the current user created this group. Narrower than `canEdit`: it gates the Delete
   *  button and the "Created by" line, because deleting stays creator-only. */
  isOwner: boolean;
  /** True when the current user may edit this group — rename it, add or remove members, change the
   *  CC list, toggle the daily recap. Edit rights equal visibility, so every group the API returns
   *  is editable; the policy lives on the server and the client just honours this flag. */
  canEdit: boolean;
  /** Creator's UPN/email. Shown on groups you didn't create, so you know who set it up and who can
   *  delete it. */
  createdBy: string;
}

/** Create/update payload sent to the API. `enabled` is honoured on CREATE only — after that the
 *  card's own toggle owns it, so updates leave it alone. */
export interface RecapGroupSaveRequest {
  name: string;
  deliveryMethod: DeliveryMethod;
  teamsChannelEmail?: string;
  members: RecapMember[];
  ccList: string[];
  /** Whether the new group also receives the daily recap email. Defaults to false: a group is a
   *  reusable list of people you can @-mention, and the recap is one opt-in behavior on it. */
  enabled?: boolean;
}
