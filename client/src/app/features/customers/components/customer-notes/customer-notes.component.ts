import { Component, input, output, effect, DestroyRef, inject, ChangeDetectionStrategy, signal, computed, viewChild, ElementRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@core/services/toast.service';
import { ApiService } from '@core/services/api.service';
import { Customer, Note, NoteMention, MentionCatalog } from '@models';

/** A single selectable row in the "@" mention dropdown. */
interface MentionOption {
  type: NoteMention['type'];
  id: string;
  name: string;
  email?: string;
  secondary?: string;
}

@Component({
  selector: 'app-customer-notes',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-notes.component.html'
})
export class CustomerNotesComponent {
  public notes = input<Note[]>([]);
  public customer = input.required<Customer>();
  public customerCodeMap = input<Map<number, string>>(new Map());
  public linkedCustomers = input<Customer[]>([]);
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
  public editNote = output<{ noteId: number; content: string }>();
  public deleteNote = output<number>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly toastService = inject(ToastService);
  private readonly apiService = inject(ApiService);

  newNote = signal('');

  // ---- "@" mention picker state ----
  noteTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('noteTextarea');
  mentionCatalog = signal<MentionCatalog>({ people: [], tradeUnits: [], groups: [] });
  /** Structured mentions chosen for the note being composed; sent to the API on submit. */
  mentions = signal<NoteMention[]>([]);
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
    for (const g of cat.groups) {
      const s = score([g.name], []);
      if (s >= 0) ranked.push({ opt: { type: 'trade-unit-group', id: String(g.groupId), name: g.name, secondary: 'Group' }, score: s });
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

  // Performance optimization: Cache sorted notes to avoid re-sorting on every change detection
  sortedNotesCache = signal<Note[]>([]);

  constructor() {
    // Load the "@" mention catalog once (per-user, not per-customer).
    this.apiService.getMentionCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(c => this.mentionCatalog.set(c));

    effect(() => {
      const _notes = this.notes();
      this._updateSortedNotesCache();
    });

    // Reset filter only when the selected customer changes, not on every note edit
    effect(() => {
      const _customer = this.customer();
      this.filterValue.set('');
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

  get displayedNotes(): Note[] {
    if (!this.filterValue()) return this.sortedNotesCache();
    const id = Number(this.filterValue());
    return this.sortedNotesCache().filter(n => n.customerId === id);
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
      // empty dropdown open.
      if (this.mentionOptions().length === 0) this.closeMentionDropdown();
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
    // Dedupe by type+id — the same person/TU/group is only sent once even if @-ed twice.
    this.mentions.update(list =>
      list.some(x => x.type === opt.type && x.id === opt.id)
        ? list
        : [...list, { type: opt.type, id: opt.id, name: opt.name, email: opt.email }]);
    this.closeMentionDropdown();
    const caretPos = (before + insert).length;
    setTimeout(() => {
      const ta = this.noteTextarea()?.nativeElement;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caretPos, caretPos);
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
      this.editNote.emit({ noteId: note.id, content: text });
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
