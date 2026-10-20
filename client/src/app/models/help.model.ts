/**
 * Self-help content, as served by GET /api/help from the API's Content/help-faq.json.
 * Mirrors HelpContentResponse on the API; see that file for the authoring rules.
 */
export interface HelpContent {
  categories: HelpCategory[];
  /** Question ids suggested when the panel opens, keyed by route. "*" is the fallback. */
  suggestions: Record<string, string[]>;
  faqs: HelpFaq[];
}

/** One category tile on the Help page. */
export interface HelpCategory {
  id: string;
  name: string;
  /** Icon key, mapped to an inline SVG by HelpIconComponent. */
  icon: string;
  faqIds: string[];
}

/**
 * One question and its layered answer. Every block after `answer` is optional and renders only when
 * present. Text uses `**double asterisks**` for bold spans and nothing else — it is split into text
 * nodes by splitHelpText, never parsed as markdown or HTML.
 */
export interface HelpFaq {
  id: string;
  question: string;
  chip?: string | null;
  keywords: string[];
  routes: string[];
  feature: string;
  answer: string;
  steps?: string[] | null;
  stepsOpen?: boolean;
  actions?: HelpAction[] | null;
  link?: HelpAction | null;
  /** Build a List example queries, by Query Library name. */
  examples?: string[] | null;
  troubleshoot?: HelpTroubleshootEntry[] | null;
  escalate?: boolean;
  related: string[];
  /** Exact on-screen labels the answer names. Guarded by help-faq.drift.spec.ts. */
  uiLabels: string[];
  lastVerified: string;
}

/**
 * A button inside an answer. Always an in-app behaviour, never a free-form URL:
 *  - route        navigate to `target` (an app route)
 *  - spotlight    outline the element carrying data-help-anchor="`target`"
 *  - tup          open Trade Unit Preferences
 *  - producer-tab open tab `target` on the selected producer
 *  - help         open the full Help page
 */
export interface HelpAction {
  kind: 'route' | 'spotlight' | 'tup' | 'producer-tab' | 'help';
  label: string;
  target?: string | null;
}

/** A "Troubleshoot this" entry: another question, or an interactive troubleshooter. */
export interface HelpTroubleshootEntry {
  label: string;
  faqId?: string | null;
  tree?: string | null;
}

/** A piece of answer text after splitting on the bold markers. */
export interface HelpTextSegment {
  text: string;
  bold: boolean;
}
