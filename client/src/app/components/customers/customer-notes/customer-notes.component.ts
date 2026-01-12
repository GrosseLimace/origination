import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../ui/button/button.component';
import { Customer, Note } from '../../../models';

@Component({
  selector: 'app-customer-notes',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    <!-- Add Note Form -->
    <div class="mb-6">
      <div class="flex gap-2">
        <textarea
          [(ngModel)]="newNote"
          placeholder="Add a note..."
          rows="2"
          class="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
        ></textarea>
        <app-button
          variant="primary"
          [disabled]="!newNote.trim()"
          (click)="submitNote()"
        >
          Add
        </app-button>
      </div>
    </div>

    @if (notes.length === 0) {
      <div class="text-center py-8 text-gray-500 dark:text-gray-400">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
        </svg>
        <p class="mt-2">No notes yet</p>
        <p class="text-sm">Add a note to keep track of important information</p>
      </div>
    } @else {
      <!-- Pinned Notes -->
      @if (pinnedNotes.length > 0) {
        <div class="mb-4">
          <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Pinned</h4>
          <div class="space-y-2">
            @for (note of pinnedNotes; track note.id) {
              <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <div class="flex justify-between items-start">
                  <div class="flex-1">
                    <p class="text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{{ note.content }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      {{ note.createdAt | date:'MMM d, y h:mm a' }}
                      @if (note.createdBy) {
                        <span> by {{ note.createdBy }}</span>
                      }
                    </p>
                  </div>
                  <button
                    class="text-yellow-600 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300"
                    (click)="togglePin.emit(note)"
                    title="Unpin note"
                  >
                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M5 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H7a2 2 0 01-2-2V5z"/>
                      <path d="M8 9v6a1 1 0 001 1h2a1 1 0 001-1V9H8z"/>
                    </svg>
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Other Notes -->
      @if (unpinnedNotes.length > 0) {
        <div>
          @if (pinnedNotes.length > 0) {
            <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Other Notes</h4>
          }
          <div class="space-y-2">
            @for (note of unpinnedNotes; track note.id) {
              <div class="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <div class="flex justify-between items-start">
                  <div class="flex-1">
                    <p class="text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{{ note.content }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      {{ note.createdAt | date:'MMM d, y h:mm a' }}
                      @if (note.createdBy) {
                        <span> by {{ note.createdBy }}</span>
                      }
                    </p>
                  </div>
                  <button
                    class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    (click)="togglePin.emit(note)"
                    title="Pin note"
                  >
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H7a2 2 0 01-2-2V5z"/>
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9v6a1 1 0 001 1h2a1 1 0 001-1V9"/>
                    </svg>
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      }
    }
  `
})
export class CustomerNotesComponent {
  @Input() notes: Note[] = [];
  @Input() customer!: Customer;
  @Output() addNote = new EventEmitter<string>();
  @Output() togglePin = new EventEmitter<Note>();

  newNote = '';

  get pinnedNotes(): Note[] {
    return this.notes.filter(n => n.isPinned).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  get unpinnedNotes(): Note[] {
    return this.notes.filter(n => !n.isPinned).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  submitNote() {
    if (this.newNote.trim()) {
      this.addNote.emit(this.newNote.trim());
      this.newNote = '';
    }
  }
}
