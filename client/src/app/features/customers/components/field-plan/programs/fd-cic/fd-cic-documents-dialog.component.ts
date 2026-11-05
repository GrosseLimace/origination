import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogContentComponent, DialogDescriptionComponent, DialogFooterComponent, DialogHeaderComponent, DialogTitleComponent } from '@shared/components/dialog/dialog.component';
import { ApiError } from '@core/errors/api-error';
import { ToastService } from '@core/services/toast.service';
import { FieldPlanDocument, FieldPlanDocumentType, FieldPlanUploadType } from '@models';
import { FieldPlanDocumentsService } from '../../store/field-plan-documents.service';

/** The dialog's sections, in the order Hope described: the producer's attestation first, then the reports. */
const SECTIONS: { type: FieldPlanDocumentType; heading: string; empty: string }[] = [
  { type: 'ProducerAttestation', heading: 'Producer attestation', empty: 'No signed attestation uploaded for this year yet.' },
  { type: 'FeedstockReport', heading: 'Biofuel Feedstock Reports', empty: 'Saved here when a field\'s CI is confirmed.' },
  { type: 'Other', heading: 'Other supporting documents', empty: 'None.' },
];

const UPLOAD_TYPES: { value: FieldPlanUploadType; label: string }[] = [
  { value: 'ProducerAttestation', label: 'Producer attestation (signed)' },
  { value: 'Other', label: 'Other supporting document' },
];

/** What the browser may show in a tab; anything else is only downloaded. The server accepts only these. */
const VIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg']);

/**
 * A producer's 45Z documents for a crop year, kept in Doc Store (category Sustainability-45z): the signed annual
 * attestation, each confirmed field's Biofuel Feedstock Report, and other supporting documents. Doc Store has no
 * screens of its own, so this is where originators see and add them. Reports arrive by confirming a field's CI;
 * only attestations and other documents are uploaded here.
 */
@Component({
  selector: 'app-fd-cic-documents-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent],
  template: `
    <app-dialog [isOpen]="true" (close)="close.emit()" size="xl" [scrollBody]="true">
      <app-dialog-header>
        <app-dialog-title>45Z documents · {{ producerName() }} · {{ year() }}</app-dialog-title>
        <app-dialog-description>Kept in Doc Store under Sustainability-45z. PDF, PNG or JPEG, up to 10 MB.</app-dialog-description>
      </app-dialog-header>

      <app-dialog-content>
        <div class="space-y-5 text-sm">
          <!-- Upload: the producer's signed attestation (done outside the app) or another document -->
          <form class="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 dark:border-gray-700 p-3" (submit)="$event.preventDefault(); upload()">
            <label class="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">Type
              <select class="h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm"
                      [ngModel]="uploadType()" (ngModelChange)="uploadType.set($event)" name="uploadType">
                @for (t of uploadTypes; track t.value) { <option [value]="t.value">{{ t.label }}</option> }
              </select>
            </label>
            <label class="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">File
              <input #fileInput type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" class="text-sm"
                     (change)="chosen.set(fileInput.files?.[0] ?? null)" data-testid="documents-file" />
            </label>
            <button type="submit" class="h-8 rounded-md px-3 text-sm font-medium text-white bg-scoular-green-accessible hover:bg-scoular-green disabled:opacity-50 border-0"
                    [disabled]="!chosen() || uploading()">{{ uploading() ? 'Uploading…' : 'Upload' }}</button>
          </form>

          <!-- Filter -->
          @if (documents().length) {
            <div class="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
              <label class="flex items-center gap-1.5">Show
                <select class="h-7 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2" [ngModel]="typeFilter()" (ngModelChange)="typeFilter.set($event)">
                  <option value="">All documents</option>
                  @for (s of sections; track s.type) { <option [value]="s.type">{{ s.heading }}</option> }
                </select>
              </label>
              @if (splitIds().length > 1) {
                <label class="flex items-center gap-1.5">Field
                  <select class="h-7 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2" [ngModel]="splitFilter()" (ngModelChange)="splitFilter.set($event)">
                    <option value="">All fields</option>
                    @for (s of splitIds(); track s) { <option [value]="s">{{ s }}</option> }
                  </select>
                </label>
              }
            </div>
          }

          @if (loading()) {
            <p class="text-gray-500 dark:text-gray-400">Loading documents…</p>
          } @else if (loadError(); as e) {
            <p class="text-amber-800 dark:text-amber-300" role="alert">{{ e }} <button type="button" class="underline bg-transparent border-0 p-0" (click)="load()">Try again</button></p>
          } @else {
            @for (s of visibleSections(); track s.type) {
              <section>
                <h4 class="font-semibold text-gray-900 dark:text-white">{{ s.heading }}</h4>
                @if (s.docs.length) {
                  <ul class="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
                    @for (d of s.docs; track d.id) {
                      <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                        <span class="font-medium text-gray-900 dark:text-white break-all">{{ d.fileName }}</span>
                        @if (d.splitId) { <span class="text-xs text-gray-600 dark:text-gray-300">Split {{ d.splitId }}{{ d.commodity ? ' · ' + d.commodity : '' }}</span> }
                        <span class="text-xs text-gray-500 dark:text-gray-400">{{ d.uploadedAt | date:'MM/dd/yy h:mm a' }}{{ d.uploadedBy ? ' · ' + d.uploadedBy : '' }} · {{ size(d.size) }}</span>
                        <span class="ml-auto flex gap-2">
                          @if (viewable(d)) {
                            <button type="button" class="h-7 rounded-md px-2 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible" (click)="open(d, true)">View</button>
                          }
                          <button type="button" class="h-7 rounded-md px-2 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible" (click)="open(d, false)">Download</button>
                        </span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="mt-1 text-gray-500 dark:text-gray-400">{{ s.empty }}</p>
                }
              </section>
            }
          }
        </div>
      </app-dialog-content>

      <app-dialog-footer>
        <button type="button" class="h-9 rounded-md px-4 text-sm text-gray-700 dark:text-gray-200 bg-transparent border border-gray-300 dark:border-gray-600" (click)="close.emit()">Close</button>
      </app-dialog-footer>
    </app-dialog>
  `,
})
export class FdCicDocumentsDialogComponent implements OnInit {
  private readonly service = inject(FieldPlanDocumentsService);
  private readonly toast = inject(ToastService);

  readonly customerId = input.required<number>();
  readonly year = input.required<number>();
  readonly producerName = input<string>('');
  readonly close = output<void>();

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly sections = SECTIONS;
  readonly uploadTypes = UPLOAD_TYPES;

  readonly documents = signal<FieldPlanDocument[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly uploadType = signal<FieldPlanUploadType>('ProducerAttestation');
  readonly chosen = signal<File | null>(null);
  readonly uploading = signal(false);
  readonly typeFilter = signal<FieldPlanDocumentType | ''>('');
  readonly splitFilter = signal('');

  readonly splitIds = computed(() =>
    [...new Set(this.documents().map(d => d.splitId).filter((s): s is string => !!s))].sort());

  readonly visibleSections = computed(() => {
    const type = this.typeFilter(), split = this.splitFilter();
    return SECTIONS.filter(s => !type || s.type === type).map(s => ({
      ...s,
      docs: this.documents().filter(d => d.documentType === s.type && (!split || s.type !== 'FeedstockReport' || d.splitId === split)),
    }));
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.documents.set(await this.service.list(this.customerId(), this.year()));
    } catch (e) {
      this.loadError.set(this.messageOf(e, 'The documents couldn\'t be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  async upload(): Promise<void> {
    const file = this.chosen();
    if (!file || this.uploading()) return;
    this.uploading.set(true);
    try {
      const doc = await this.service.upload(this.customerId(), this.year(), this.uploadType(), file);
      this.documents.update(ds => [doc, ...ds]);
      this.chosen.set(null);
      const el = this.fileInput()?.nativeElement;
      if (el) el.value = '';
      this.toast.success(`${doc.fileName} saved to Doc Store.`);
    } catch (e) {
      this.toast.error(this.messageOf(e, 'The document couldn\'t be uploaded.'));
    } finally {
      this.uploading.set(false);
    }
  }

  viewable(d: FieldPlanDocument): boolean {
    return VIEWABLE.has(d.contentType);
  }

  /** Opens the document in a new tab (PDF and images only) or saves it. */
  async open(d: FieldPlanDocument, view: boolean): Promise<void> {
    // Opened before the await, so the browser treats it as the click's own window rather than a popup.
    const tab = view ? window.open('', '_blank') : null;
    try {
      const blob = await this.service.content(this.customerId(), d.id);
      // Typed from the allow-list, never from what came back, so the tab can only ever render PDF or an image.
      const typed = new Blob([blob], { type: VIEWABLE.has(d.contentType) ? d.contentType : 'application/octet-stream' });
      const url = URL.createObjectURL(typed);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = d.fileName;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      this.toast.error(this.messageOf(e, 'The document couldn\'t be opened.'));
    }
  }

  size(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  private messageOf(e: unknown, fallback: string): string {
    return e instanceof ApiError && e.message ? e.message : fallback;
  }
}
