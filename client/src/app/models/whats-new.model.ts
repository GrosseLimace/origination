/** How a change is labelled in the panel: New, Improved, or Fixed. */
export type WhatsNewItemKind = 'added' | 'changed' | 'fixed';

/** A single user-facing change within a release. */
export interface WhatsNewItem {
  kind: WhatsNewItemKind;
  text: string;
  /**
   * Optional heading this item sits under. Lets one release present several features
   * separately without becoming several releases — the seen/unseen check keys on the
   * release version, so splitting a deploy into multiple entries would hide all but the
   * newest from a first-time visitor. Absent means "no heading".
   */
  group?: string;
}

/**
 * One release from the API's curated notes. The list arrives newest first and the first
 * entry is the current release, so versions are only ever compared for equality — never
 * parsed or ordered on the client.
 */
export interface WhatsNewRelease {
  version: string;
  releasedOn: string;
  title: string;
  summary?: string;
  items: WhatsNewItem[];
}

/**
 * Identifies the running build. `releaseVersion` is the human release number from the notes
 * file; `commitSha` and `buildNumber` are stamped by CI and read "local" on a developer box.
 */
export interface AppVersionInfo {
  releaseVersion: string | null;
  releasedOn: string | null;
  commitSha: string;
  shortSha: string;
  buildNumber: string;
  environment: string;
}
