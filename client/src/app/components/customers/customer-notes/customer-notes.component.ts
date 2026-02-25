import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../ui/button/button.component';
import { Customer, Note } from '../../../models';

@Component({
  selector: 'app-customer-notes',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Add Note Form -->
      <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
        <textarea
          [(ngModel)]="newNote"
          placeholder="Add a note about this customer..."
          rows="3"
          class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
        ></textarea>
        <div class="flex justify-end mt-4">
          <app-button
            variant="default"
            [disabled]="!newNote.trim()"
            (onClick)="submitNote()"
          >
            Add Note
          </app-button>
        </div>
      </div>

      <!-- Notes List -->
      @if (notes.length === 0) {
        <div class="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg class="mx-auto h-12 w-12 text-gray-400 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
          </svg>
          <p class="mt-4">No notes yet for this customer</p>
        </div>
      } @else {
        <div class="space-y-6">
          @for (note of sortedNotesCache; track note.id) {
            <div class="border rounded-lg p-4 relative" [ngClass]="getNoteClass(note)">
              <!-- Top right actions -->
              <div class="absolute top-3 right-3 flex items-center gap-2">
                <!-- Pin/Unpin button -->
                <button
                  (click)="togglePin.emit(note)"
                  class="inline-flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1 rounded-md transition-colors"
                  [ngClass]="note.isPinned ? 'text-amber-600 dark:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30' : 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-700'"
                >
                  @if (note.isPinned) {
                    <!-- pin icon -->
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" x2="12" y1="17" y2="22"/>
                      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
                    </svg>
                    <span>Unpin Note</span>
                  } @else {
                    <!-- pin-off icon -->
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="2" x2="22" y1="2" y2="22"/>
                      <line x1="12" x2="12" y1="17" y2="22"/>
                      <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12"/>
                      <path d="M15 9.34V6h1a2 2 0 0 0 0-4H7.89"/>
                    </svg>
                    <span>Pin Note</span>
                  }
                </button>

                <!-- Three-dot menu button -->
                <div class="relative">
                  <button
                    (click)="toggleMenu(note.id, $event)"
                    class="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="1" fill="currentColor"/>
                      <circle cx="12" cy="5" r="1" fill="currentColor"/>
                      <circle cx="12" cy="19" r="1" fill="currentColor"/>
                    </svg>
                  </button>

                  <!-- Dropdown menu -->
                  @if (openMenuId === note.id) {
                    <!-- Invisible backdrop to close menu when clicking outside -->
                    <div class="fixed inset-0 z-10" (click)="closeMenu()"></div>

                    <div class="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20">
                      <button
                        (click)="startEdit(note)"
                        class="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                      >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                        Edit Note
                      </button>
                      <button
                        (click)="confirmDelete(note)"
                        class="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 rounded-b-lg"
                      >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                        Delete Note
                      </button>
                    </div>
                  }
                </div>
              </div>

              <!-- Avatar and author info -->
              <div class="flex items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-700 pr-32">
                <div class="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-300">
                  {{ getInitials(note.createdBy || 'User') }}
                </div>
                <div>
                  <div class="font-medium text-gray-900 dark:text-white">
                    {{ note.createdBy || 'User' }}
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatTimestamp(note.createdAt) }}</span>
                    @if (customerCodeMap.size > 1 && customerCodeMap.has(note.customerId)) {
                      <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                        {{ customerCodeMap.get(note.customerId) }}
                      </span>
                    }
                  </div>
                </div>
              </div>

              <!-- Note content (view mode) -->
              @if (editingNoteId !== note.id) {
                <p class="text-gray-700 dark:text-gray-300 whitespace-pre-wrap pt-3">{{ note.content }}</p>
              }

              <!-- Note content (edit mode) -->
              @if (editingNoteId === note.id) {
                <div class="space-y-3 pt-3">
                  <textarea
                    [(ngModel)]="editContent"
                    rows="4"
                    class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                  ></textarea>
                  <div class="flex justify-end gap-2">
                    <app-button variant="outline" (onClick)="cancelEdit()">Cancel</app-button>
                    <app-button variant="default" (onClick)="saveEdit(note)" [disabled]="!editContent.trim()">Save</app-button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Delete Confirmation Dialog -->
      @if (showDeleteConfirm && noteToDelete) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-hidden" (click)="cancelDelete()">
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6 overflow-y-auto max-h-[90vh]" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Delete Note?</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Are you sure you want to delete this note? This action cannot be undone.
            </p>
            <div class="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 mb-4 space-y-3">
              <div class="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-600">
                <span class="text-sm font-medium text-gray-900 dark:text-gray-300">{{ noteToDelete.createdBy || 'User' }}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">•</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatTimestamp(noteToDelete.createdAt) }}</span>
              </div>
              <p class="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">
                {{ noteToDelete.content }}
              </p>
            </div>
            <div class="flex justify-end gap-2">
              <app-button variant="outline" (onClick)="cancelDelete()">Cancel</app-button>
              <app-button variant="default" (onClick)="executeDelete()" class="bg-red-600 hover:bg-red-700 text-white">Delete</app-button>
            </div>
          </div>
        </div>
      }
    </div>
  `
})
export class CustomerNotesComponent implements OnChanges, OnDestroy {
  @Input() notes: Note[] = [];
  @Input() customer!: Customer;
  @Input() customerCodeMap: Map<number, string> = new Map();
  @Output() addNote = new EventEmitter<string>();
  @Output() togglePin = new EventEmitter<Note>();
  @Output() editNote = new EventEmitter<{ noteId: number; content: string }>();
  @Output() deleteNote = new EventEmitter<number>();

  private cdr = inject(ChangeDetectorRef);

  newNote = '';
  openMenuId: number | null = null;
  editingNoteId: number | null = null;
  editContent = '';
  showDeleteConfirm = false;
  noteToDelete: Note | null = null;

  // Performance optimization: Cache sorted notes to avoid re-sorting on every change detection
  sortedNotesCache: Note[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    // Only re-sort when notes input actually changes
    if (changes['notes']) {
      this.updateSortedNotesCache();
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    // Ensure body scroll is restored if component is destroyed while dialog is open
    if (this.showDeleteConfirm) {
      document.body.style.overflow = '';
    }
  }

  /**
   * Performance optimization: Sort notes once and cache the result.
   * Only re-sort when notes input changes.
   *
   * Previously: sortedNotes getter sorted on EVERY change detection cycle
   * Now: Sort only when notes actually change
   */
  private updateSortedNotesCache(): void {
    this.sortedNotesCache = [...this.notes].sort((a, b) => {
      // Pinned notes first
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      // Then by date (newest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
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
    // Treat bare ISO strings as UTC (API returns without Z suffix)
    const raw = typeof timestamp === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp)
      ? timestamp + 'Z' : timestamp;
    const date = new Date(raw);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // Check if same day
    if (diffDays < 1 && now.getDate() === date.getDate()) {
      return `Today at ${timeStr}`;
    }

    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear()) {
      return `Yesterday at ${timeStr}`;
    }

    // Within a week
    if (diffDays < 7) {
      return `${diffDays} days ago`;
    }

    // Otherwise show full date
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  submitNote() {
    if (this.newNote.trim()) {
      this.addNote.emit(this.newNote.trim());
      this.newNote = '';
    }
  }

  toggleMenu(noteId: number, event: Event) {
    event.stopPropagation();
    this.openMenuId = this.openMenuId === noteId ? null : noteId;
    this.cdr.markForCheck();
  }

  closeMenu() {
    this.openMenuId = null;
    this.cdr.markForCheck();
  }

  startEdit(note: Note) {
    this.editingNoteId = note.id;
    this.editContent = note.content;
    this.openMenuId = null;
    this.cdr.markForCheck();
  }

  cancelEdit() {
    this.editingNoteId = null;
    this.editContent = '';
    this.cdr.markForCheck();
  }

  saveEdit(note: Note) {
    if (this.editContent.trim() && this.editContent !== note.content) {
      this.editNote.emit({ noteId: note.id, content: this.editContent.trim() });
    }
    this.editingNoteId = null;
    this.editContent = '';
  }

  confirmDelete(note: Note) {
    this.noteToDelete = note;
    this.showDeleteConfirm = true;
    this.openMenuId = null;
    // Prevent body scroll when dialog opens
    document.body.style.overflow = 'hidden';
    this.cdr.markForCheck();
  }

  cancelDelete() {
    this.noteToDelete = null;
    this.showDeleteConfirm = false;
    // Restore body scroll when dialog closes
    document.body.style.overflow = '';
    this.cdr.markForCheck();
  }

  executeDelete() {
    if (this.noteToDelete) {
      this.deleteNote.emit(this.noteToDelete.id);
      this.noteToDelete = null;
      this.showDeleteConfirm = false;
      // Restore body scroll when dialog closes
      document.body.style.overflow = '';
    }
  }
}
