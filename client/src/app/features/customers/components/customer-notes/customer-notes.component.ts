import { Component, input, output, effect, DestroyRef, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@core/services/toast.service';
import { Customer, Note } from '@models';

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
  public addNote = output<string>();
  public togglePin = output<Note>();
  public editNote = output<{ noteId: number; content: string }>();
  public deleteNote = output<number>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly toastService = inject(ToastService);

  newNote = signal('');
  openMenuId = signal<number | null>(null);
  editingNoteId = signal<number | null>(null);
  editContent = signal('');
  showDeleteConfirm = signal(false);
  noteToDelete = signal<Note | null>(null);
  filterValue = signal(''); // '' = All; customer id as string when a producer is selected

  // Performance optimization: Cache sorted notes to avoid re-sorting on every change detection
  sortedNotesCache = signal<Note[]>([]);

  constructor() {
    effect(() => {
      const _notes = this.notes();
      this._updateSortedNotesCache();
    });

    // Reset filter only when the selected customer changes, not on every note edit
    effect(() => {
      const _customer = this.customer();
      this.filterValue.set('');
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
    const text = this.newNote().trim();
    if (!text) return;
    if (text.length > 5000) {
      this.toastService.error('Note exceeds 5,000 character limit. Please shorten it before submitting.');
      return;
    }
    this.addNote.emit(text);
    this.newNote.set('');
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
