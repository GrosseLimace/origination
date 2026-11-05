import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
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

/** What can be shown in the dialog; anything else is only downloaded. The server accepts only these. */
const VIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg']);

/** A document open in the viewer: its file as a blob URL, typed from the allow-list. */
interface Viewing { doc: FieldPlanDocument; url: string; pdf: boolean }

/**
 * A producer's 45Z documents for a crop year, kept in Doc Store (category Sustainability-45z): the signed annual
 * attestation, each confirmed field's Biofuel Feedstock Report, and other supporting documents. Doc Store has no
 * screens of its own, so this is where originators see and add them. Reports arrive by confirming a field's CI;
 * only attestations and other documents are uploaded here.
 *
 * View shows the document inside the dialog (not a new tab, which a browser set to download PDFs leaves blank),
 * with Print and Download. A browser that won't show PDFs at all gets a plain message and Download instead.
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
        @if (viewing(); as v) {
          <!-- The viewer: the document inside the dialog, with Back, Print and Download -->
          <div class="flex flex-col gap-3 text-sm" data-testid="document-viewer">
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="h-8 rounded-md px-3 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible" (click)="closeViewer()">← Back to documents</button>
              <span class="font-medium text-gray-900 dark:text-white break-all">{{ v.doc.fileName }}</span>
              <span class="ml-auto flex gap-2">
                @if (canShow(v)) {
                  <button type="button" class="h-8 rounded-md px-3 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible" (click)="print()">Print</button>
                }
                <button type="button" class="h-8 rounded-md px-3 text-xs font-medium text-white bg-scoular-green-accessible hover:bg-scoular-green border-0" (click)="save(v)">Download</button>
              </span>
            </div>
            @if (canShow(v)) {
              <iframe #viewer [title]="v.doc.fileName" class="h-[70vh] w-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50"></iframe>
            } @else {
              <p class="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-900 dark:text-amber-200" role="status">
                This browser is set to download PDFs rather than show them, so this one can't be shown here. Use Download to open it.
              </p>
            }
          </div>
        } @else {
        <div class="space-y-5 text-sm">
          <!-- Upload: the producer's signed attestation (done outside the app) or another document -->
          <form class="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 dark:border-gray-700 p-3" (submit)="$event.preventDefault(); upload()">
            <label class="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">Type
              <select class="h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm"
                      [ngModel]="uploadType()" (ngModelChange)="uploadType.set($event)" name="uploadType">
                @for (t of uploadTypes; track t.value) { <option [value]="t.value">{{ t.label }}</option> }
              </select>
            </label>
            <label class="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">File
              <input #fileInput type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                     class="text-sm text-gray-700 dark:text-gray-200 cursor-pointer file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-solid file:border-scoular-green-accessible file:bg-white dark:file:bg-gray-800 file:px-4 file:text-sm file:font-medium file:text-scoular-green-accessible hover:file:bg-scoular-green-accessible hover:file:text-white"
                     (change)="chosen.set(fileInput.files?.[0] ?? null)" data-testid="documents-file" />
            </label>
            <button type="submit" class="h-9 rounded-md px-4 text-sm font-medium text-white bg-scoular-green-accessible hover:bg-scoular-green disabled:opacity-50 border-0"
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
                            <button type="button" class="h-7 rounded-md px-2 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible" [disabled]="opening()" (click)="view(d)">View</button>
                          }
                          <button type="button" class="h-7 rounded-md px-2 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible" [disabled]="opening()" (click)="download(d)">Download</button>
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
        }
      </app-dialog-content>

      <app-dialog-footer>
        <button type="button" class="h-9 rounded-md px-4 text-sm text-gray-700 dark:text-gray-200 bg-transparent border border-gray-300 dark:border-gray-600" (click)="close.emit()">Close</button>
      </app-dialog-footer>
    </app-dialog>
  `,
})
export class FdCicDocumentsDialogComponent implements OnInit, OnDestroy {
  private readonly service = inject(FieldPlanDocumentsService);
  private readonly toast = inject(ToastService);

  readonly customerId = input.required<number>();
  readonly year = input.required<number>();
  readonly producerName = input<string>('');
  readonly close = output<void>();

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly viewerFrame = viewChild<ElementRef<HTMLIFrameElement>>('viewer');

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
  readonly opening = signal(false);
  readonly viewing = signal<Viewing | null>(null);

  readonly splitIds = computed(() =>
    [...new Set(this.documents().map(d => d.splitId).filter((s): s is string => !!s))].sort());

  readonly visibleSections = computed(() => {
    const type = this.typeFilter(), split = this.splitFilter();
    return SECTIONS.filter(s => !type || s.type === type).map(s => ({
      ...s,
      docs: this.documents().filter(d => d.documentType === s.type && (!split || s.type !== 'FeedstockReport' || d.splitId === split)),
    }));
  });

  constructor() {
    // The frame's src is set here rather than bound: it's a blob URL this component made from an allow-listed
    // type, so it needs no sanitizer bypass (the SPA's CSP frame-src allows blob: for this).
    effect(() => {
      const frame = this.viewerFrame()?.nativeElement, v = this.viewing();
      if (frame && v && frame.src !== v.url) frame.src = v.url;
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.closeViewer();
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

  /** Whether the viewer can show it: images always; a PDF only where the browser's PDF viewer is on. */
  canShow(v: Viewing): boolean {
    return !v.pdf || navigator.pdfViewerEnabled !== false;
  }

  /** Opens the document in the dialog's viewer. */
  async view(d: FieldPlanDocument): Promise<void> {
    const url = await this.fetchUrl(d);
    if (!url) return;
    this.closeViewer();
    this.viewing.set({ doc: d, url, pdf: d.contentType === 'application/pdf' });
  }

  /** Saves the document without opening it. */
  async download(d: FieldPlanDocument): Promise<void> {
    const url = await this.fetchUrl(d);
    if (!url) return;
    this.saveAs(url, d.fileName);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  save(v: Viewing): void {
    this.saveAs(v.url, v.doc.fileName);
  }

  print(): void {
    const frame = this.viewerFrame()?.nativeElement.contentWindow;
    try {
      frame?.focus();
      frame?.print();
    } catch {
      this.toast.error('This browser won\'t print from here. Use Download, then print the file.');
    }
  }

  closeViewer(): void {
    const v = this.viewing();
    if (v) URL.revokeObjectURL(v.url);
    this.viewing.set(null);
  }

  size(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  /** The document as a blob URL, typed from the allow-list, never from what came back. */
  private async fetchUrl(d: FieldPlanDocument): Promise<string | null> {
    if (this.opening()) return null;
    this.opening.set(true);
    try {
      const blob = await this.service.content(this.customerId(), d.id);
      return URL.createObjectURL(new Blob([blob], { type: VIEWABLE.has(d.contentType) ? d.contentType : 'application/octet-stream' }));
    } catch (e) {
      this.toast.error(this.messageOf(e, 'The document couldn\'t be opened.'));
      return null;
    } finally {
      this.opening.set(false);
    }
  }

  private saveAs(url: string, fileName: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }

  private messageOf(e: unknown, fallback: string): string {
    return e instanceof ApiError && e.message ? e.message : fallback;
  }
}
