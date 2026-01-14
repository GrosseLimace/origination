import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../ui/button/button.component';
import { Customer, Note } from '../../../models';

@Component({
  selector: 'app-customer-notes',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
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
          @for (note of sortedNotes; track note.id) {
            <div class="border rounded-lg p-4 relative" [ngClass]="getNoteClass(note)">
              <!-- Pin icon in top right if pinned -->
              @if (note.isPinned) {
                <div class="absolute top-3 right-3 text-amber-500">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" x2="12" y1="17" y2="22"/>
                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
                  </svg>
                </div>
              }

              <!-- Avatar and author info -->
              <div class="flex items-center gap-3 mb-3">
                <div class="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-300">
                  {{ getInitials(note.createdBy || 'User') }}
                </div>
                <div>
                  <div class="font-medium text-gray-900 dark:text-white">
                    {{ note.createdBy || 'User' }}
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    {{ formatTimestamp(note.createdAt) }}
                  </div>
                </div>
              </div>

              <!-- Note content -->
              <p class="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {{ note.content }}
              </p>

              <!-- Pin action below note with divider -->
              <div class="border-t border-gray-200 dark:border-gray-700 mt-4 pt-4">
                <button
                  (click)="togglePin.emit(note)"
                  class="inline-flex items-center gap-2 text-sm cursor-pointer"
                  [ngClass]="note.isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-gray-400 hover:text-amber-500'"
                >
                  @if (note.isPinned) {
                    <!-- pin icon -->
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" x2="12" y1="17" y2="22"/>
                      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
                    </svg>
                    <span>Unpin Note</span>
                  } @else {
                    <!-- pin-off icon -->
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="2" x2="22" y1="2" y2="22"/>
                      <line x1="12" x2="12" y1="17" y2="22"/>
                      <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12"/>
                      <path d="M15 9.34V6h1a2 2 0 0 0 0-4H7.89"/>
                    </svg>
                    <span>Pin Note</span>
                  }
                </button>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class CustomerNotesComponent {
  @Input() notes: Note[] = [];
  @Input() customer!: Customer;
  @Output() addNote = new EventEmitter<string>();
  @Output() togglePin = new EventEmitter<Note>();

  newNote = '';

  get sortedNotes(): Note[] {
    return [...this.notes].sort((a, b) => {
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
    const date = new Date(timestamp);
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
}
