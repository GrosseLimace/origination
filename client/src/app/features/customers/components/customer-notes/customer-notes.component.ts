import { Component, input, output, effect, DestroyRef, inject, ChangeDetectionStrategy, signal, computed, viewChild, ElementRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ClampOverflowDirective } from '@shared/directives/clamp-overflow.directive';
import { ToastService } from '@core/services/toast.service';
import { ApiService } from '@core/services/api.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { TeamsDirectoryService, GraphTeamsChannel } from '@core/services/teams-directory.service';
import { Customer, Note, NoteMention, MentionCatalog } from '@models';
import { environment } from '@env/environment';
import { binSiteNames, splitByBinSiteNames, BIN_SITE_NAME_CLASS } from '@shared/utils/bin-site-mentions';

/** A single selectable row in the "@" mention dropdown. */
interface MentionOption {
  type: NoteMention['type'];
  id: string;
  name: string;
  email?: string;
  secondary?: string;
  /** Set on a Teams channel that Graph offered but nobody has registered yet. Picking it registers
   *  the channel first, which is what turns it into a usable mention id. */
  pendingChannel?: GraphTeamsChannel;
}

@Component({
  selector: 'app-customer-notes',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ClampOverflowDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-notes.component.html'
})
export class CustomerNotesComponent {
  public notes = input<Note[]>([]);
  public customer = input.required<Customer>();
  public customerCodeMap = input<Map<number, string>>(new Map());
  public linkedCustomers = input<Customer[]>([]);
  /** True while the parent is fetching this producer's notes (notes load per-producer on
   *  selection now). While loading and empty, show a spinner instead of "No notes yet" so
   *  a producer WITH notes doesn't flash a misleading empty state. */
  public isLoadingNotes = input<boolean>(false);
  /** True while the parent has an in-flight createNote request. Used to disable the
   *  Add Note button + switch its label to "Saving..." so the user sees feedback that
   *  their click landed. Fixes the "had to click 2-3 times" bug — without this signal,
   *  the textarea cleared instantly, the user thought nothing happened, and they
   *  retyped + reclicked (creating 2-3 duplicate notes on the customer). */
  public isSavingNote = input<boolean>(false);
  /** Counter the parent increments each time a save SUCCEEDS. The component watches
   *  for increments and only then clears the textarea — so if the save fails, the
   *  user's typed content is preserved and they can retry without retyping. */
  public noteSaveSucceededCounter = input<number>(0);
  /** When set, the add-note form is disabled and this message is shown instead of the
   *  input — used for a not-yet-onboarded producer who must be assigned a trade unit first. */
  public addDisabledReason = input<string | null>(null);
  public addNote = output<{ content: string; mentions: NoteMention[] }>();
  public togglePin = output<Note>();
  public editNote = output<{ noteId: number; content: string; mentions: NoteMention[] }>();
  public deleteNote = output<number>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly toastService = inject(ToastService);
  private readonly apiService = inject(ApiService);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly teamsDirectory = inject(TeamsDirectoryService);

  newNote = signal('');

  // ---- "@" mention picker state ----
  noteTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('noteTextarea');
  /** Backdrop div mirroring the textarea text so selected @mentions render green while typing. */
  noteBackdrop = viewChild<ElementRef<HTMLDivElement>>('noteBackdrop');
  mentionCatalog = signal<MentionCatalog>({ people: [], tradeUnits: [], tradeUnitGroups: [], appGroups: [], teamsChannels: [] });
  /** Teams channels the signed-in user belongs to, read from Graph with their own token. Empty when
   *  the feature is off or consent hasn't been granted — the picker then behaves as it always did. */
  teamsChannelsFromGraph = signal<GraphTeamsChannel[]>([]);
  /** Structured mentions chosen for the note being composed; sent to the API on submit. */
  mentions = signal<NoteMention[]>([]);
  /** Live segmentation of the compose text so already-selected @mentions show green as the
   *  user keeps typing (turns green on select, not only after the note is saved). */
  /** Live segmentation of the compose text: @mentions green, and the producer's bin-site names
   *  highlighted as soon as they are typed (user 2026-10-09) so the writer can see the note will show
   *  with that bin on Build a List. */
  readonly composeSegments = computed(() =>
    this._withBinSites(
      this._segmentMentions(this.newNote(), this.mentions().map(m => m.name))
        .map(seg => ({ text: seg.text, kind: (seg.mention ? 'mention' : 'plain') as 'plain' | 'mention' })),
      this._binSiteNamesFor(this.customer().id))
  );
  mentionDropdownOpen = signal(false);
  mentionQuery = signal('');
  mentionActiveIndex = signal(0);
  private mentionAtIndex = -1;  // index of the triggering '@' in the textarea value
  private mentionCaret = 0;     // caret position when the query was captured

  /** Catalog rows ranked by relevance to the current "@" query, capped for the dropdown.
   *  Mentionable types: people, trade units, and trade-unit groups.
   *  Ranking puts matches on the PRIMARY identifier (TU code, person name/UPN, group name)
   *  above matches that only hit a SECONDARY field (TU description, person email). So "@1084"
   *  surfaces that trade unit, and "@Corn Belt" surfaces the group above trade units whose
   *  location name merely contains "corn" (e.g. "ABI WET BREW CORN"). */
  /** The API answers 200 even when one of the picker's sources was unreachable; this is the only
   *  way the user learns the list is incomplete rather than genuinely empty. */
  readonly mentionCatalogDegraded = computed(() => this.mentionCatalog().degraded === true);

  mentionOptions = computed<MentionOption[]>(() => {
    if (!this.mentionDropdownOpen()) return [];
    const q = this.mentionQuery().trim().toLowerCase();
    if (!q) return [];
    const cat = this.mentionCatalog();

    // Lower score = better match. -1 means no match (excluded).
    const score = (primary: string[], secondary: string[]): number => {
      const prim = primary.map(s => s.toLowerCase()).filter(Boolean);
      const sec = secondary.map(s => s.toLowerCase()).filter(Boolean);
      if (prim.some(s => s.startsWith(q))) return 0;
      if (prim.some(s => s.includes(q))) return 1;
      if (sec.some(s => s.startsWith(q))) return 2;
      if (sec.some(s => s.includes(q))) return 3;
      return -1;
    };

    const ranked: { opt: MentionOption; score: number }[] = [];
    for (const p of cat.people) {
      const s = score([p.displayName, p.userId], [p.email]);
      if (s >= 0) ranked.push({ opt: { type: 'person', id: p.userId, name: p.displayName, email: p.email, secondary: p.email }, score: s });
    }
    for (const t of cat.tradeUnits) {
      const s = score([t.code], [t.description ?? '']);
      if (s >= 0) ranked.push({ opt: { type: 'trade-unit', id: t.code, name: t.code, secondary: t.description || 'Trade unit' }, score: s });
    }
    for (const g of cat.tradeUnitGroups) {
      const s = score([g.name], []);
      // "Trade unit group", not "Group" — the user's own groups are in this same flat list now,
      // and two different things reading identically is worse than a longer label.
      if (s >= 0) ranked.push({ opt: { type: 'trade-unit-group', id: String(g.groupId), name: g.name, secondary: 'Trade unit group' }, score: s });
    }
    for (const g of cat.appGroups ?? []) {
      const s = score([g.name], []);
      // A Teams entry is labelled by its DESTINATION, not a member count: mentioning it posts to
      // the channel and emails nobody, and it may legitimately have no members at all —
      // "0 members" would read as "this will notify no one", the opposite of the truth.
      const members = `${g.memberCount} member${g.memberCount === 1 ? '' : 's'}`;
      const secondary = g.postsToChannel ? 'Group · Posts to Teams channel' : `Group · ${members}`;
      if (s >= 0) ranked.push({ opt: { type: 'app-group', id: String(g.groupId), name: g.name, secondary }, score: s });
    }

    // Teams channels. Two sources, merged so a channel never appears twice: ones already registered
    // (mentionable by anyone, and the only ones that exist if this user's Graph lookup failed), and
    // ones read from the signed-in user's own teams that nobody has picked yet. Registered wins,
    // because it already has the id a mention needs.
    const registeredByChannelId = new Map<string, string>();
    for (const c of cat.teamsChannels ?? []) {
      registeredByChannelId.set(c.channelId, String(c.channelDbId));
      const s = score([c.displayName], [c.teamName]);
      if (s >= 0) ranked.push({
        opt: { type: 'teams-channel', id: String(c.channelDbId), name: c.displayName, secondary: `Teams channel · ${c.teamName}` },
        score: s,
      });
    }
    for (const c of this.teamsChannelsFromGraph()) {
      if (registeredByChannelId.has(c.channelId)) continue;
      const s = score([c.displayName], [c.teamName]);
      // id is empty until the pick registers it — selectMention fills it in from the response.
      if (s >= 0) ranked.push({
        opt: { type: 'teams-channel', id: '', name: c.displayName, secondary: `Teams channel · ${c.teamName}`, pendingChannel: c },
        score: s,
      });
    }

    ranked.sort((a, b) => a.score - b.score || a.opt.name.localeCompare(b.opt.name));
    return ranked.map(r => r.opt).slice(0, 8);
  });
  openMenuId = signal<number | null>(null);
  editingNoteId = signal<number | null>(null);
  editContent = signal('');
  showDeleteConfirm = signal(false);
  noteToDelete = signal<Note | null>(null);
  filterValue = signal(''); // '' = All; customer id as string when a producer is selected
  noteSearch = signal(''); // free-text filter over note content/author/date; '' = no filter

  // Performance optimization: Cache sorted notes to avoid re-sorting on every change detection
  sortedNotesCache = signal<Note[]>([]);

  constructor() {
    // Load the "@" mention catalog once (per-user, not per-customer).
    this.apiService.getMentionCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(c => this.mentionCatalog.set(c));

    // The user's own Teams channels, read from Graph with their own token. Flag-gated because it
    // needs admin consent per environment; the service already degrades to an empty list, so the
    // flag is about not paying for a lookup that cannot succeed yet.
    if (environment.teamsChannelMentionsEnabled) {
      this.teamsDirectory.getChannels()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(channels => this.teamsChannelsFromGraph.set(channels));
    }

    effect(() => {
      const _notes = this.notes();
      this._updateSortedNotesCache();
    });

    // Reset filters (producer + search) only when the selected customer changes, not on every note edit
    effect(() => {
      const _customer = this.customer();
      this.filterValue.set('');
      this.noteSearch.set('');
    });

    // Clear the textarea only after the parent reports a successful save (counter goes
    // up). We start the tracker at the initial counter value so the component doesn't
    // wipe out user input on mount if the counter is already non-zero (e.g., a prior
    // save in this session). On failure, the parent leaves the counter alone — the
    // textarea content survives and the user can retry without retyping.
    let lastSeenSuccessCount = this.noteSaveSucceededCounter();
    effect(() => {
      const current = this.noteSaveSucceededCounter();
      if (current > lastSeenSuccessCount) {
        this.newNote.set('');
        this.mentions.set([]);
        this.closeMentionDropdown();
        // Collapse the box back to its min height after the content clears (next tick, post-render).
        setTimeout(() => this.autoGrowNote());
      }
      lastSeenSuccessCount = current;
    });

    this.destroyRef.onDestroy(() => {
      // Ensure body scroll is restored if component is destroyed while dialog is open
      if (this.showDeleteConfirm()) {
        document.body.style.overflow = '';
      }
    });
  }

  /** Notes to render: sorted cache, narrowed by the producer filter (when a linked customer is
   *  selected) and then by the free-text search. Search matches note content, author (created/
   *  modified by) and the created/modified dates, case-insensitive, where a note matches only if it
   *  contains ALL of the typed words (AND) — so a full date like "Jun 17, 2026" pins to that day. */
  readonly displayedNotes = computed<Note[]>(() => {
    const sorted = this.sortedNotesCache();
    const producerId = this.filterValue();
    const byProducer = producerId
      ? sorted.filter(n => n.customerId === Number(producerId))
      : sorted;

    const terms = this.noteSearch().trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return byProducer;

    return byProducer.filter(n => {
      const hay = this._noteSearchHaystack(n);
      return terms.every(t => hay.includes(t));
    });
  });

  /** Lowercased searchable text for a note: content + author(s) + created/modified dates. Dates
   *  are included in both numeric (1/3/2026) and long (January 3, 2026) forms so "1/3", "2026",
   *  "jan", or "january" all match. */
  private _noteSearchHaystack(n: Note): string {
    return [
      n.content,
      n.createdBy,
      n.modifiedBy,
      this._dateSearchText(n.createdAt),
      this._dateSearchText(n.modifiedAt),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  /** Formats a note timestamp into searchable date text, or '' if absent/invalid. Mirrors
   *  _parseNoteTime's UTC handling for bare ISO strings. */
  private _dateSearchText(ts: string | Date | undefined | null): string {
    if (!ts) return '';
    const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString('en-US')} ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  }

  /**
   * Performance optimization: Sort notes once and cache the result.
   * Only re-sort when notes input changes.
   *
   * Previously: sortedNotes getter sorted on EVERY change detection cycle
   * Now: Sort only when notes actually change
   */
  private _parseNoteTime(ts: string | Date): number {
    if (!ts) return 0;
    const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
    return new Date(raw).getTime();
  }

  private _updateSortedNotesCache(): void {
    this.sortedNotesCache.set([...this.notes()].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const aTime = this._parseNoteTime(a.createdAt);
      const bTime = this._parseNoteTime(b.createdAt);
      return bTime - aTime;
    }));
  }

  getNoteClass(note: Note): { [key: string]: boolean } {
    return {
      'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20': note.isPinned,
      'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800': !note.isPinned
    };
  }

  /** Segments a saved note's body for display: @mention runs (shown green, signalling the note was
   *  shared with them) plus, within the remaining text, any current search-term matches (highlighted).
   *  Pure string splitting into text segments — no HTML is built, so there is no XSS surface. */
  /** Bin-site names per producer shown in this panel (the producer and any linked producers whose
   *  notes appear here), so a note is highlighted against its own producer's sites. */
  private readonly _binSiteNamesByCustomer = computed(() => {
    const map = new Map<number, string[]>();
    for (const c of [this.customer(), ...this.linkedCustomers()]) map.set(c.id, binSiteNames(c.binSites));
    return map;
  });

  private _binSiteNamesFor(customerId: number | null | undefined): string[] {
    return customerId == null ? [] : (this._binSiteNamesByCustomer().get(customerId) ?? []);
  }

  /** Splits the plain runs further by bin-site name (same matching Build a List uses). */
  private _withBinSites<K extends string>(segs: { text: string; kind: K | 'plain' }[], siteNames: string[]): { text: string; kind: K | 'plain' | 'bin' }[] {
    if (siteNames.length === 0) return segs;
    const out: { text: string; kind: K | 'plain' | 'bin' }[] = [];
    for (const seg of segs) {
      if (seg.kind !== 'plain') { out.push(seg); continue; }
      for (const run of splitByBinSiteNames(seg.text, siteNames)) out.push({ text: run.text, kind: run.bin ? 'bin' : 'plain' });
    }
    return out;
  }

  readonly binSiteNameClass = BIN_SITE_NAME_CLASS;
  /** Hover text on a bin-site name. */
  readonly binSiteTitle = 'Bin site — this note shows with the producer on Build a List (Grain on Farm & Bin Sites)';

  noteViewSegments(note: Note): { text: string; kind: 'plain' | 'mention' | 'search' | 'bin' }[] {
    // Only mentions the author actually typed produce highlight tokens. Rows carrying `via` were
    // expanded server-side out of a group mention — they're recipients, not text the author wrote,
    // so highlighting their names would light up words that merely happen to appear in the note.
    const typedNames = (note.mentions ?? []).filter(m => !m.via).map(m => m.name);
    const mentionSegs = this._segmentMentions(note.content ?? '', typedNames);
    const terms = this.noteSearch().trim().toLowerCase().split(/\s+/).filter(Boolean);

    // Mentions first, then bin-site names (user 2026-10-09: so readers can tell a note is about a bin and
    // will show on Build a List), then search terms inside what is still plain.
    const withBins = this._withBinSites(
      mentionSegs.map(seg => ({ text: seg.text, kind: (seg.mention ? 'mention' : 'plain') as 'plain' | 'mention' })),
      this._binSiteNamesFor(note.customerId));
    const out: { text: string; kind: 'plain' | 'mention' | 'search' | 'bin' }[] = [];
    for (const seg of withBins) {
      if (seg.kind !== 'plain' || terms.length === 0) { out.push(seg); continue; }
      for (const part of this._splitBySearchTerms(seg.text, terms)) out.push(part);
    }
    return out;
  }

  /** Splits a plain text run into search-match / non-match segments (case-insensitive). One capture
   *  group so String.split keeps the matched text — odd indices are the matches. */
  private _splitBySearchTerms(text: string, terms: string[]): { text: string; kind: 'plain' | 'search' }[] {
    if (!text) return [];
    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(${escaped.join('|')})`, 'gi');
    return text
      .split(re)
      .map((part, i) => ({ text: part, kind: (i % 2 === 1 ? 'search' : 'plain') as 'plain' | 'search' }))
      .filter(seg => seg.text.length > 0);
  }

  /** Matches the exact "@Name" tokens the composer inserts (see selectMention), longest name
   *  first so "@Caden Egr" wins over a shorter "@Caden". Pure string matching — no HTML is built,
   *  so there is no XSS surface. Shared by the saved-note view and the live compose highlight. */
  private _segmentMentions(content: string, names: string[]): { text: string; mention: boolean }[] {
    const tokens = [...new Set(names.map(n => '@' + n).filter(t => t.length > 1))]
      .sort((a, b) => b.length - a.length);
    if (tokens.length === 0) return [{ text: content, mention: false }];

    const segments: { text: string; mention: boolean }[] = [];
    const pushChar = (ch: string) => {
      const last = segments[segments.length - 1];
      if (last && !last.mention) last.text += ch;
      else segments.push({ text: ch, mention: false });
    };

    let i = 0;
    while (i < content.length) {
      let hit: string | null = null;
      if (content[i] === '@') {
        for (const t of tokens) {
          if (content.startsWith(t, i)) { hit = t; break; }
        }
      }
      if (hit) {
        segments.push({ text: hit, mention: true });
        i += hit.length;
      } else {
        pushChar(content[i]);
        i++;
      }
    }
    return segments;
  }

  /** Keep the highlight backdrop scrolled in lockstep with the textarea (multi-line notes). */
  syncBackdropScroll(): void {
    const ta = this.noteTextarea()?.nativeElement;
    const bd = this.noteBackdrop()?.nativeElement;
    if (ta && bd) { bd.scrollTop = ta.scrollTop; bd.scrollLeft = ta.scrollLeft; }
  }

  /** Largest the compose box grows to before it starts scrolling internally (~10 lines). */
  private static readonly NOTE_MAX_HEIGHT_PX = 320;
  private growRaf = 0;

  /** Grow the note textarea to fit its content (up to NOTE_MAX_HEIGHT_PX), instead of scrolling
   *  inside a fixed 3-row box. A fixed box let the mention-highlight backdrop's text bleed past
   *  the border when the note overflowed; growing to fit removes that. Also drops the scrollbar
   *  while it fits, so the transparent textarea and the backdrop wrap text identically (keeping
   *  the green @mention highlight pixel-aligned with the caret). The backdrop is absolute
   *  inset-0, so it tracks the new height automatically.
   *
   *  The height measurement forces a reflow (set height:auto → read scrollHeight), so it is
   *  batched into one requestAnimationFrame — running it synchronously on every keystroke made
   *  fast typing visibly lag. Rapid keystrokes coalesce into a single resize per frame. */
  private autoGrowNote(): void {
    if (this.growRaf) return; // a resize is already queued for the next frame
    this.growRaf = requestAnimationFrame(() => {
      this.growRaf = 0;
      const ta = this.noteTextarea()?.nativeElement;
      if (!ta) return;
      const max = CustomerNotesComponent.NOTE_MAX_HEIGHT_PX;
      ta.style.height = 'auto';                                 // reset so scrollHeight is the true content height
      ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
      ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
      this.syncBackdropScroll();
    });
  }

  getInitials(name: string): string {
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return '??';
  }

  formatTimestamp(timestamp: string | Date): string {
    // Treat bare ISO strings as UTC (API returns GETUTCDATE() without Z suffix)
    const raw = typeof timestamp === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp)
      ? timestamp + 'Z' : timestamp;
    const date = new Date(raw);

    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // Compare calendar days in local time, not raw ms difference.
    // A note from 7:57 PM yesterday is ~20 hours ago — ms-based diffDays floors to 0 and
    // incorrectly shows "Today". Midnight-normalised comparison gives the right calendar day.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const noteMidnight = new Date(date);
    noteMidnight.setHours(0, 0, 0, 0);
    const diffDays = Math.round((todayMidnight.getTime() - noteMidnight.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return `Today at ${timeStr}`;
    if (diffDays === 1) return `Yesterday at ${timeStr}`;
    if (diffDays < 7)  return `${diffDays} days ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  onFilterChange(val: string): void {
    this.filterValue.set(val);
  }

  getCustomerLabel(customer: Customer): string {
    return customer.scoularId
      ? `${customer.name} (${customer.scoularId})`
      : customer.name;
  }

  submitNote() {
    // Ignore clicks while a save is already in flight — without this, a slow first
    // request could overlap with a second click and create duplicate notes.
    if (this.isSavingNote()) return;
    const text = this.newNote().trim();
    if (!text) return;
    if (text.length > 5000) {
      this.toastService.error('Note exceeds 5,000 character limit. Please shorten it before submitting.');
      return;
    }
    // Only keep mentions whose "@Name" is still present in the note text — so a mention the
    // user deleted from the text isn't sent. The text is the source of truth; mentions are
    // tracked silently (no visible chips) for the future send endpoint.
    const mentions = this.mentions().filter(m => text.includes('@' + m.name));
    this.addNote.emit({ content: text, mentions });
    // Don't clear the textarea here — wait for the parent to report success
    // (noteSaveSucceededCounter increments). If the save fails, the user's text
    // stays intact so they can retry without retyping.
  }

  // ---- "@" mention picker ----

  /** Recompute the mention dropdown from the caret position. Fires on input/keyup/click. */
  onNoteCaretChange(): void {
    const ta = this.noteTextarea()?.nativeElement;
    if (!ta) return;
    this.autoGrowNote(); // fires on (input) → keep the box sized to its content as the user types
    const value = ta.value;
    const pos = ta.selectionStart ?? value.length;
    // Active mention = an "@" at a word boundary, then a first non-space char, then any run of
    // characters up to the caret — spaces allowed, so multi-word names like "Caden Testing" match
    // while typing. No newline or second "@" inside. Requiring the first char to be non-space means
    // a bare "@" (or "@ ") shows nothing until the user types a letter.
    const match = value.slice(0, pos).match(/(?:^|\s)@([^\s@][^\n@]*)$/);
    if (match) {
      this.mentionAtIndex = pos - match[1].length - 1;
      this.mentionCaret = pos;
      this.mentionQuery.set(match[1]);
      this.mentionActiveIndex.set(0);
      this.mentionDropdownOpen.set(true);
      // The query now tolerates spaces, so it would otherwise keep matching after a completed
      // mention (e.g. "@Corn Belt and then..."). Close once nothing matches instead of leaving an
      // empty dropdown open. A degraded catalog is the exception: the dropdown then carries the
      // "couldn't load everyone" notice, which matters most exactly when nothing matches.
      if (this.mentionOptions().length === 0 && !this.mentionCatalogDegraded()) this.closeMentionDropdown();
    } else {
      this.closeMentionDropdown();
    }
  }

  /** Arrow/Enter/Escape navigation while the dropdown is open. */
  onNoteKeydown(event: KeyboardEvent): void {
    if (!this.mentionDropdownOpen()) return;
    const opts = this.mentionOptions();
    if (opts.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.mentionActiveIndex.update(i => (i + 1) % opts.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.mentionActiveIndex.update(i => (i - 1 + opts.length) % opts.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.selectMention(opts[this.mentionActiveIndex()]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMentionDropdown();
    }
  }

  /** Insert the chosen mention into the text and record it structurally. */
  selectMention(opt: MentionOption): void {
    if (this.mentionAtIndex < 0) return;
    const value = this.newNote();
    const before = value.slice(0, this.mentionAtIndex);
    const after = value.slice(this.mentionCaret);
    const insert = `@${opt.name} `;
    this.newNote.set(before + insert + after);
    // A Teams channel nobody has picked before has no id yet. Register it, then record the mention
    // with the id that comes back. The text is already in the box, so the only visible difference is
    // that the name turns green a moment later; if registration fails the text stays as plain text
    // and the toast says why, which is honest — no mention was recorded, so nothing will be posted.
    if (opt.pendingChannel) {
      this.apiService.registerTeamsChannel(opt.pendingChannel)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: registered => this.mentions.update(list =>
            list.some(x => x.type === 'teams-channel' && x.id === String(registered.id))
              ? list
              : [...list, { type: 'teams-channel', id: String(registered.id), name: opt.name }]),
          error: () => this.toastService.error(
            `Couldn't set up "${opt.name}" for mentions. Try again, or remove it from the note.`),
        });
      this.closeMentionDropdown();
      this._focusAfterMention(before + insert);
      this.usageTracking.postClickEvent('interaction', 'customers', 'notes-mention', `${opt.type}:new`);
      return;
    }

    // Dedupe by type+id — the same person/TU/group is only sent once even if @-ed twice.
    this.mentions.update(list =>
      list.some(x => x.type === opt.type && x.id === opt.id)
        ? list
        : [...list, { type: opt.type, id: opt.id, name: opt.name, email: opt.email }]);
    this.closeMentionDropdown();
    // Note create/edit/delete/pin are all visible from their API calls; picking a mention is not,
    // so it's the one part of the notes flow that needs an explicit event.
    this.usageTracking.postClickEvent('interaction', 'customers', 'notes-mention', `${opt.type}:${opt.id}`);
    this._focusAfterMention(before + insert);
  }

  /** Restores focus and puts the caret after the text just inserted. */
  private _focusAfterMention(textBeforeCaret: string): void {
    const caretPos = textBeforeCaret.length;
    setTimeout(() => {
      const ta = this.noteTextarea()?.nativeElement;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caretPos, caretPos);
        this.autoGrowNote(); // inserted mention may add a line — resize (also syncs backdrop)
      }
    });
  }

  closeMentionDropdown(): void {
    this.mentionDropdownOpen.set(false);
    this.mentionQuery.set('');
    this.mentionAtIndex = -1;
  }


  toggleMenu(noteId: number, event: Event) {
    event.stopPropagation();
    this.openMenuId.update(id => id === noteId ? null : noteId);
  }

  closeMenu() {
    this.openMenuId.set(null);
  }

  startEdit(note: Note) {
    this.editingNoteId.set(note.id);
    this.editContent.set(note.content);
    this.openMenuId.set(null);
  }

  cancelEdit() {
    this.editingNoteId.set(null);
    this.editContent.set('');
  }

  saveEdit(note: Note) {
    const text = this.editContent().trim();
    if (!text) return;
    if (text.length > 5000) {
      this.toastService.error('Note exceeds 5,000 character limit. Please shorten it before saving.');
      return;
    }
    if (text !== note.content) {
      // Send the mentions that survive the edited text, mirroring submitNote's rule — deleting
      // "@Name" from the body drops that mention. Rows the server expanded out of a group (`via`)
      // are deliberately NOT echoed back: the group row alone is sent and the server re-expands it,
      // so membership changes are picked up and there is one owner of that derivation.
      const mentions = (note.mentions ?? []).filter(m => !m.via && text.includes('@' + m.name));
      this.editNote.emit({ noteId: note.id, content: text, mentions });
    }
    this.editingNoteId.set(null);
    this.editContent.set('');
  }

  confirmDelete(note: Note) {
    this.noteToDelete.set(note);
    this.showDeleteConfirm.set(true);
    this.openMenuId.set(null);
    // Prevent body scroll when dialog opens
    document.body.style.overflow = 'hidden';
  }

  cancelDelete() {
    this.noteToDelete.set(null);
    this.showDeleteConfirm.set(false);
    // Restore body scroll when dialog closes
    document.body.style.overflow = '';
  }

  expandedNotes = new Set<number>();

  /** Note ids whose content is actually clipped by the line-clamp (reported by
   *  ClampOverflowDirective). Drives the "Show more" button so it appears for every
   *  truncated note, not just long-by-character-count ones. */
  readonly overflowingNotes = signal(new Set<number>());

  isNoteExpanded(id: number): boolean {
    return this.expandedNotes.has(id);
  }

  toggleNoteExpand(id: number): void {
    if (this.expandedNotes.has(id)) {
      this.expandedNotes.delete(id);
    } else {
      this.expandedNotes.add(id);
    }
  }

  /** Record whether a note's clamped content overflows (from ClampOverflowDirective). */
  setNoteOverflow(id: number, overflowing: boolean): void {
    this.overflowingNotes.update(set => {
      if (set.has(id) === overflowing) return set; // no change → keep reference stable
      const next = new Set(set);
      overflowing ? next.add(id) : next.delete(id);
      return next;
    });
  }

  isNoteOverflowing(id: number): boolean {
    return this.overflowingNotes().has(id);
  }

  executeDelete() {
    if (this.noteToDelete()) {
      this.deleteNote.emit(this.noteToDelete()!.id);
      this.noteToDelete.set(null);
      this.showDeleteConfirm.set(false);
      // Restore body scroll when dialog closes
      document.body.style.overflow = '';
    }
  }
}
