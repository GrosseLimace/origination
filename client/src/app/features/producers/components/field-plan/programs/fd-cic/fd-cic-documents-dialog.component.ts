import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogContentComponent, DialogDescriptionComponent, DialogFooterComponent, DialogHeaderComponent, DialogTitleComponent } from '@shared/components/dialog/dialog.component';
import { ApiError } from '@core/errors/api-error';
import { alreadyShown } from '@core/http/shown-errors';
import { ToastService } from '@core/services/toast.service';
import { FieldPlanDocument, FieldPlanDocumentStatus, FieldPlanDocumentType, FieldPlanUploadType } from '../../../../models/field-plan.model';
import { FieldPlanDocumentsService } from '../../store/field-plan-documents.service';
import { HasPermissionDirective } from '@core/access/has-permission.directive';
import { parseCsv } from './csv-table';

/**
 * The dialog's sections, in the order Hope described: the producer's attestation first, then each field's report
 * and ledger. `perField` documents are saved per field and year by confirming; the rest are per year and uploaded.
 */
const SECTIONS: { type: FieldPlanDocumentType; heading: string; label: string; empty: string; perField: boolean }[] = [
  { type: 'ProducerAttestation', heading: 'Producer attestation', label: 'Producer attestation', empty: 'No signed attestation uploaded for this year yet.', perField: false },
  { type: 'FeedstockReport', heading: 'Biofuel Feedstock Reports', label: 'Biofuel Feedstock Report', empty: 'Saved here, per field, when a field\'s CI is confirmed.', perField: true },
  { type: 'MassBalanceLedger', heading: '45Z Mass Balance Ledgers', label: '45Z Mass Balance Ledger', empty: 'Saved here, per field, when a field\'s CI is confirmed.', perField: true },
  { type: 'Other', heading: 'Other supporting documents', label: 'Other supporting document', empty: 'None.', perField: false },
];
const SECTION = new Map(SECTIONS.map(s => [s.type, s]));

const UPLOAD_TYPES: { value: FieldPlanUploadType; label: string }[] = [
  { value: 'ProducerAttestation', label: 'Producer attestation (signed)' },
  { value: 'Other', label: 'Other supporting document' },
];

/** The archive reason the server gives an attestation replaced by a newer upload (FieldPlanDocumentService.AttestationReplacedNote). */
const ATTESTATION_REPLACED = 'Replaced by a newer producer attestation.';

/** What can be shown in the dialog; anything else is only downloaded. The server accepts only these. */
const VIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/csv']);

/** A document open in the viewer: a PDF or image as a blob URL typed from the allow-list, or a ledger's rows. */
interface Viewing { doc: FieldPlanDocument; url: string; kind: 'pdf' | 'image' | 'csv'; rows: string[][] }

const BUTTON = 'h-7 rounded-md px-2 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible disabled:opacity-50';
const SELECT = 'h-7 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2';

/**
 * A producer's 45Z documents, kept in Doc Store (category Sustainability-45z): the signed annual attestation, each
 * confirmed field's Biofuel Feedstock Report (PDF) and 45Z Mass Balance Ledger (CSV), and other supporting
 * documents. Doc Store has no screens of its own, so this is where originators see and add them. Reports and
 * ledgers arrive by confirming a field's CI; only attestations and other documents are uploaded here.
 *
 * "Current documents" is the crop year's current set. "Version history" is every year's overwritten documents
 * (a report or ledger replaced when its field's CI was confirmed again) and archived ones (set aside by an
 * originator, who can restore them). Nothing is ever deleted from Doc Store. Uploading, archiving and restoring are for
 * a user who may change field plans; anyone who can see the field plan can view and download.
 *
 * View shows the document inside the dialog with the browser's own PDF viewer (as Contract Workspace does), with
 * Print and Download; a ledger is shown as a table. A browser set to download PDFs gets a plain message and
 * Download instead.
 */
@Component({
  selector: 'app-fd-cic-documents-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent, HasPermissionDirective],
  template: `
    <app-dialog [isOpen]="true" (close)="close.emit()" size="xl" [scrollBody]="true">
      <app-dialog-header>
        <app-dialog-title>45Z documents · {{ producerName() }} · {{ year() }}</app-dialog-title>
        <app-dialog-description>Kept in Doc Store under Sustainability-45z.<ng-container *appHasPermission="'field-plans:write'"> Upload a PDF, PNG or JPEG, up to 10 MB.</ng-container></app-dialog-description>
      </app-dialog-header>

      <app-dialog-content>
        @if (viewing(); as v) {
          <!-- The viewer: the document inside the dialog, with Back, Print and Download -->
          <div class="flex flex-col gap-3 text-sm" data-testid="document-viewer">
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="h-8 rounded-md px-3 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible" (click)="closeViewer()">← Back to {{ tab() === 'history' ? 'version history' : 'documents' }}</button>
              <span class="flex flex-col">
                <span class="font-medium text-gray-900 dark:text-white break-all">{{ v.doc.fileName }}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">{{ describe(v.doc) }}@if (v.doc.status !== 'Current') { · {{ v.doc.status }} }</span>
              </span>
              <span class="ml-auto flex gap-2">
                @if (v.kind !== 'csv' && canShow(v)) {
                  <button type="button" class="h-8 rounded-md px-3 text-xs border border-gray-300 dark:border-gray-600 bg-transparent text-gray-700 dark:text-gray-200 hover:border-scoular-green-accessible" (click)="print()">Print</button>
                }
                <button type="button" class="h-8 rounded-md px-3 text-xs font-medium text-white bg-scoular-green-accessible hover:bg-scoular-green border-0" (click)="save(v)">Download</button>
              </span>
            </div>
            @if (v.kind === 'csv') {
              <div class="max-h-[70vh] overflow-auto rounded-md border border-gray-200 dark:border-gray-700" data-testid="ledger-table">
                <table class="min-w-full text-xs">
                  <thead class="sticky top-0 bg-gray-50 dark:bg-gray-800">
                    <tr>@for (h of v.rows[0]; track $index) { <th class="px-2 py-1.5 text-left font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">{{ h }}</th> }</tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                    @for (row of v.rows.slice(1); track $index) {
                      <tr>@for (cell of row; track $index) { <td class="px-2 py-1.5 text-gray-900 dark:text-white whitespace-nowrap">{{ cell }}</td> }</tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else if (canShow(v)) {
              <iframe #viewer [title]="v.doc.fileName" class="h-[70vh] w-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50"></iframe>
            } @else {
              <p class="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-900 dark:text-amber-200" role="status">
                This browser is set to download PDFs rather than show them, so this one can't be shown here. Use Download to open it.
              </p>
            }
          </div>
        } @else {
        <div class="space-y-5 text-sm">
          <!-- Tabs: the year's current documents, or every year's overwritten and archived ones -->
          <div class="flex gap-1 border-b border-gray-200 dark:border-gray-700" role="tablist">
            <button type="button" role="tab" [attr.aria-selected]="tab() === 'current'" data-testid="tab-current"
                    class="-mb-px border-b-2 px-3 py-1.5 text-sm bg-transparent" [class]="tab() === 'current' ? 'border-scoular-green-accessible font-semibold text-gray-900 dark:text-white' : 'border-transparent text-gray-600 dark:text-gray-300'"
                    (click)="tab.set('current')">Current documents</button>
            <button type="button" role="tab" [attr.aria-selected]="tab() === 'history'" data-testid="tab-history"
                    class="-mb-px border-b-2 px-3 py-1.5 text-sm bg-transparent" [class]="tab() === 'history' ? 'border-scoular-green-accessible font-semibold text-gray-900 dark:text-white' : 'border-transparent text-gray-600 dark:text-gray-300'"
                    (click)="tab.set('history')">Version history{{ history().length ? ' (' + history().length + ')' : '' }}</button>
          </div>

          @if (loading()) {
            <p class="text-gray-500 dark:text-gray-400">Loading documents…</p>
          } @else if (loadError(); as e) {
            <p class="text-amber-800 dark:text-amber-300" role="alert">{{ e }} <button type="button" class="underline bg-transparent border-0 p-0" (click)="load()">Try again</button></p>
          } @else if (tab() === 'current') {
            <!-- Upload: the producer's signed attestation (done outside the app) or another document -->
            <form *appHasPermission="'field-plans:write'" class="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 dark:border-gray-700 p-3" (submit)="$event.preventDefault(); upload()">
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
              @if (replacedAttestation(); as old) {
                <p class="basis-full text-xs text-amber-800 dark:text-amber-300" data-testid="attestation-replaces">
                  This replaces {{ old.fileName }} as the {{ year() }} attestation. The old one is archived and stays in Version history.
                </p>
              }
            </form>

            <!-- Filter -->
            @if (current().length) {
              <div class="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
                <label class="flex items-center gap-1.5">Show
                  <select [class]="select" [ngModel]="typeFilter()" (ngModelChange)="typeFilter.set($event)">
                    <option value="">All documents</option>
                    @for (s of sections; track s.type) { <option [value]="s.type">{{ s.heading }}</option> }
                  </select>
                </label>
                @if (fields().length > 1) {
                  <label class="flex items-center gap-1.5">Field
                    <select [class]="select" [ngModel]="splitFilter()" (ngModelChange)="splitFilter.set($event)">
                      <option value="">All fields</option>
                      @for (f of fields(); track f.splitId) { <option [value]="f.splitId">{{ f.label }}</option> }
                    </select>
                  </label>
                }
              </div>
            }

            @for (s of visibleSections(); track s.type) {
              <section [attr.data-testid]="'section-' + s.type">
                <h4 class="font-semibold text-gray-900 dark:text-white">{{ s.heading }}</h4>
                @if (s.docs.length) {
                  <ul class="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
                    @for (d of s.docs; track d.id) {
                      <li class="py-1.5">
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span class="flex min-w-0 flex-col">
                            @if (s.perField) { <span class="font-medium text-gray-900 dark:text-white">{{ fieldLabel(d) }} · {{ d.cropYear }}{{ d.commodity ? ' · ' + d.commodity : '' }}</span> }
                            <button type="button" class="text-left break-all bg-transparent border-0 p-0 underline-offset-2 hover:underline disabled:no-underline"
                                    [class]="s.perField ? 'text-xs text-gray-600 dark:text-gray-300' : 'font-medium text-gray-900 dark:text-white'"
                                    [disabled]="opening() || !viewable(d)" (click)="view(d)">{{ d.fileName }}</button>
                            <span class="text-xs text-gray-500 dark:text-gray-400">{{ d.uploadedAt | date:'MM/dd/yy h:mm a' }}{{ d.uploadedBy ? ' · ' + d.uploadedBy : '' }} · {{ size(d.size) }}</span>
                          </span>
                          <span class="ml-auto flex gap-2">
                            @if (viewable(d)) { <button type="button" [class]="button" [disabled]="opening()" (click)="view(d)">View</button> }
                            <button type="button" [class]="button" [disabled]="opening()" (click)="download(d)">Download</button>
                            <button *appHasPermission="'field-plans:write'" type="button" [class]="button" [disabled]="busy()" (click)="startArchive(d)" [attr.data-testid]="'archive-' + d.id">Archive</button>
                          </span>
                        </div>
                        @if (archiving() === d.id) {
                          <form class="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 dark:bg-gray-800 p-2" (submit)="$event.preventDefault(); archive(d)">
                            <label class="flex grow flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">Why is it being archived? (optional)
                              <input type="text" maxlength="500" name="archiveNote" placeholder="e.g. No longer relevant to {{ year() }}"
                                     class="h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-sm"
                                     [ngModel]="archiveNote()" (ngModelChange)="archiveNote.set($event)" />
                            </label>
                            <button type="submit" class="h-8 rounded-md px-3 text-xs font-medium text-white bg-scoular-green-accessible hover:bg-scoular-green border-0 disabled:opacity-50" [disabled]="busy()">Archive</button>
                            <button type="button" class="h-8 rounded-md px-3 text-xs bg-transparent border border-gray-300 dark:border-gray-600" (click)="archiving.set(null)">Cancel</button>
                            <span class="basis-full text-xs text-gray-500 dark:text-gray-400">It moves to Version history, where it can still be viewed, downloaded and restored.</span>
                          </form>
                        }
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="mt-1 text-gray-500 dark:text-gray-400">{{ s.empty }}</p>
                }
              </section>
            }
          } @else {
            <!-- Version history: every year's overwritten and archived documents -->
            <p class="text-xs text-gray-600 dark:text-gray-300">
              <span class="font-semibold">Overwritten</span>: a field's report or ledger replaced when its CI was confirmed again.
              <span class="font-semibold">Archived</span>: set aside by an originator (e.g. no longer relevant to the year); it can be restored.
            </p>
            <div class="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
              <label class="flex items-center gap-1.5">Year
                <select [class]="select" [ngModel]="historyYear()" (ngModelChange)="historyYear.set(+$event)" data-testid="history-year">
                  <option [ngValue]="0">All years</option>
                  @for (y of historyYears(); track y) { <option [ngValue]="y">{{ y }}</option> }
                </select>
              </label>
              <label class="flex items-center gap-1.5">Show
                <select [class]="select" [ngModel]="historyType()" (ngModelChange)="historyType.set($event)">
                  <option value="">All documents</option>
                  @for (s of sections; track s.type) { <option [value]="s.type">{{ s.heading }}</option> }
                </select>
              </label>
              @if (historyFields().length) {
                <label class="flex items-center gap-1.5">Field
                  <select [class]="select" [ngModel]="historySplit()" (ngModelChange)="historySplit.set($event)">
                    <option value="">All fields</option>
                    @for (f of historyFields(); track f.splitId) { <option [value]="f.splitId">{{ f.label }}</option> }
                  </select>
                </label>
              }
              <label class="flex items-center gap-1.5">Status
                <select [class]="select" [ngModel]="historyStatus()" (ngModelChange)="historyStatus.set($event)">
                  <option value="">Overwritten and archived</option>
                  <option value="Overwritten">Overwritten</option>
                  <option value="Archived">Archived</option>
                </select>
              </label>
            </div>

            @if (visibleHistory().length) {
              <ul class="divide-y divide-gray-100 dark:divide-gray-700" data-testid="history-list">
                @for (d of visibleHistory(); track d.id) {
                  <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <span class="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                          [class]="d.status === 'Overwritten' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100'">{{ d.status }}</span>
                    <span class="flex min-w-0 flex-col">
                      <span class="font-medium text-gray-900 dark:text-white">{{ describe(d) }}</span>
                      <button type="button" class="text-left text-xs break-all text-gray-600 dark:text-gray-300 bg-transparent border-0 p-0 underline-offset-2 hover:underline disabled:no-underline"
                              [disabled]="opening() || !viewable(d)" (click)="view(d)">{{ d.fileName }}</button>
                      <span class="text-xs text-gray-500 dark:text-gray-400">Saved {{ d.uploadedAt | date:'MM/dd/yy h:mm a' }}{{ d.uploadedBy ? ' by ' + d.uploadedBy : '' }} · {{ statusLine(d) }}</span>
                    </span>
                    <span class="ml-auto flex gap-2">
                      @if (viewable(d)) { <button type="button" [class]="button" [disabled]="opening()" (click)="view(d)">View</button> }
                      <button type="button" [class]="button" [disabled]="opening()" (click)="download(d)">Download</button>
                      @if (d.status === 'Archived') { <button *appHasPermission="'field-plans:write'" type="button" [class]="button" [disabled]="busy()" (click)="restore(d)" [attr.data-testid]="'restore-' + d.id">Restore</button> }
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-gray-500 dark:text-gray-400" data-testid="history-empty">No overwritten or archived documents{{ history().length ? ' match these filters' : ' yet' }}.</p>
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
  readonly button = BUTTON;
  readonly select = SELECT;

  /** Every year's documents for the producer: the current tab shows this year's current ones, history the rest. */
  readonly documents = signal<FieldPlanDocument[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly tab = signal<'current' | 'history'>('current');
  readonly uploadType = signal<FieldPlanUploadType>('ProducerAttestation');
  readonly chosen = signal<File | null>(null);
  readonly uploading = signal(false);
  readonly typeFilter = signal<FieldPlanDocumentType | ''>('');
  readonly splitFilter = signal('');
  readonly opening = signal(false);
  readonly viewing = signal<Viewing | null>(null);
  /** The document whose Archive form is open, its reason, and an archive or restore in flight. */
  readonly archiving = signal<string | null>(null);
  readonly archiveNote = signal('');
  readonly busy = signal(false);
  /** Version history filters; year 0 is every year. */
  readonly historyYear = signal(0);
  readonly historyType = signal<FieldPlanDocumentType | ''>('');
  readonly historySplit = signal('');
  readonly historyStatus = signal<Exclude<FieldPlanDocumentStatus, 'Current'> | ''>('');

  readonly current = computed(() => this.documents().filter(d => d.status === 'Current' && d.cropYear === this.year()));
  readonly history = computed(() => this.documents().filter(d => d.status !== 'Current'));

  /** The year's current attestation that an attestation upload would replace (and the server would archive). */
  readonly replacedAttestation = computed(() => this.uploadType() === 'ProducerAttestation'
    ? this.current().find(d => d.documentType === 'ProducerAttestation') ?? null
    : null);

  /** This year's fields with a current report or ledger, for the Field filter. */
  readonly fields = computed(() => fieldsOf(this.current()));

  readonly visibleSections = computed(() => {
    const type = this.typeFilter(), split = this.splitFilter();
    return SECTIONS.filter(s => !type || s.type === type).map(s => ({
      ...s,
      docs: this.current().filter(d => d.documentType === s.type && (!split || !s.perField || d.splitId === split)),
    }));
  });

  readonly historyYears = computed(() =>
    [...new Set(this.history().map(d => d.cropYear).filter((y): y is number => !!y))].sort((a, b) => b - a));

  /** Fields with an overwritten or archived report or ledger in the chosen year, for the history's Field filter. */
  readonly historyFields = computed(() => {
    const year = this.historyYear(), type = this.historyType();
    if (type && !SECTION.get(type)?.perField) return [];
    return fieldsOf(this.history().filter(d => !year || d.cropYear === year));
  });

  /** The history, filtered, most recently overwritten or archived first. */
  readonly visibleHistory = computed(() => {
    const year = this.historyYear(), type = this.historyType(), status = this.historyStatus();
    // A field chosen for another year or type no longer in the list doesn't hide everything.
    const split = this.historyFields().some(f => f.splitId === this.historySplit()) ? this.historySplit() : '';
    return this.history()
      .filter(d => (!year || d.cropYear === year) && (!type || d.documentType === type) && (!status || d.status === status)
        && (!split || d.splitId === split))
      .sort((a, b) => (b.statusChangedAt ?? b.uploadedAt).localeCompare(a.statusChangedAt ?? a.uploadedAt));
  });

  constructor() {
    // The frame's src is set here rather than bound: it's a blob URL this component made from an allow-listed
    // type, so it needs no sanitizer bypass (the SPA's CSP frame-src allows blob: for this).
    effect(() => {
      const frame = this.viewerFrame()?.nativeElement, v = this.viewing();
      if (frame && v && v.url && frame.src !== v.url) frame.src = v.url;
    });
  }

  ngOnInit(): void {
    this.historyYear.set(this.year());
    void this.load();
  }

  ngOnDestroy(): void {
    this.closeViewer();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.documents.set(await this.service.list(this.customerId()));
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
      const replaced = this.replacedAttestation();
      const doc = await this.service.upload(this.customerId(), this.year(), this.uploadType(), file);
      // The server archived the year's previous attestation in the same save; show it that way without reloading.
      this.documents.update(ds => [doc, ...ds.map(d => replaced && d.id === replaced.id
        ? { ...d, status: 'Archived' as const, statusChangedAt: doc.uploadedAt, statusChangedBy: doc.uploadedBy, statusNote: ATTESTATION_REPLACED, replacedById: doc.id }
        : d)]);
      this.chosen.set(null);
      const el = this.fileInput()?.nativeElement;
      if (el) el.value = '';
      this.toast.success(replaced
        ? `${doc.fileName} saved to Doc Store. The previous attestation is archived in Version history.`
        : `${doc.fileName} saved to Doc Store.`);
    } catch (e) {
      if (!alreadyShown(e)) this.toast.error(this.messageOf(e, 'The document couldn\'t be uploaded.'));
    } finally {
      this.uploading.set(false);
    }
  }

  startArchive(d: FieldPlanDocument): void {
    this.archiveNote.set('');
    this.archiving.set(d.id);
  }

  async archive(d: FieldPlanDocument): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.replace(await this.service.archive(this.customerId(), d.id, this.archiveNote().trim() || null));
      this.archiving.set(null);
      this.toast.success(`${d.fileName} archived. It's in Version history.`);
    } catch (e) {
      if (!alreadyShown(e)) this.toast.error(this.messageOf(e, 'The document couldn\'t be archived.'));
    } finally {
      this.busy.set(false);
    }
  }

  async restore(d: FieldPlanDocument): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.replace(await this.service.restore(this.customerId(), d.id));
      this.toast.success(`${d.fileName} restored to current documents.`);
    } catch (e) {
      if (!alreadyShown(e)) this.toast.error(this.messageOf(e, 'The document couldn\'t be restored.'));
    } finally {
      this.busy.set(false);
    }
  }

  viewable(d: FieldPlanDocument): boolean {
    return VIEWABLE.has(d.contentType);
  }

  /** Whether the viewer can show it: images and ledgers always; a PDF only where the browser's PDF viewer is on. */
  canShow(v: Viewing): boolean {
    return v.kind !== 'pdf' || navigator.pdfViewerEnabled !== false;
  }

  /** e.g. "Biofuel Feedstock Report · South Field (TATOB43) · 2026", or "Producer attestation · 2026". */
  describe(d: FieldPlanDocument): string {
    const section = SECTION.get(d.documentType);
    return [section?.label ?? d.documentType, section?.perField ? this.fieldLabel(d) : null, d.cropYear].filter(p => p).join(' · ');
  }

  fieldLabel(d: FieldPlanDocument): string {
    return fieldLabelOf(d);
  }

  /** How an overwritten or archived document got there. */
  statusLine(d: FieldPlanDocument): string {
    const when = d.statusChangedAt ? ` ${new Date(d.statusChangedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}` : '';
    const by = d.statusChangedBy ? ` by ${d.statusChangedBy}` : '';
    return d.status === 'Overwritten'
      ? `Overwritten${when} when the field's CI was confirmed again${by}`
      : `Archived${when}${by}${d.statusNote ? `: ${d.statusNote}` : ''}`;
  }

  /** Opens the document in the dialog's viewer. */
  async view(d: FieldPlanDocument): Promise<void> {
    const blob = await this.fetch(d);
    if (!blob) return;
    this.closeViewer();
    if (d.contentType === 'text/csv') {
      this.viewing.set({ doc: d, url: URL.createObjectURL(blob), kind: 'csv', rows: parseCsv(await blob.text()) });
    } else {
      this.viewing.set({ doc: d, url: URL.createObjectURL(blob), kind: d.contentType === 'application/pdf' ? 'pdf' : 'image', rows: [] });
    }
  }

  /** Saves the document without opening it. */
  async download(d: FieldPlanDocument): Promise<void> {
    const blob = await this.fetch(d);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
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
    if (v?.url) URL.revokeObjectURL(v.url);
    this.viewing.set(null);
  }

  size(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  /** Puts the server's copy of a document in place of the one shown. */
  private replace(doc: FieldPlanDocument): void {
    this.documents.update(ds => ds.map(d => d.id === doc.id ? doc : d));
  }

  /** The document's file, typed from the allow-list, never from what came back. */
  private async fetch(d: FieldPlanDocument): Promise<Blob | null> {
    if (this.opening()) return null;
    this.opening.set(true);
    try {
      const blob = await this.service.content(this.customerId(), d.id);
      return new Blob([blob], { type: VIEWABLE.has(d.contentType) ? d.contentType : 'application/octet-stream' });
    } catch (e) {
      if (!alreadyShown(e)) this.toast.error(this.messageOf(e, 'The document couldn\'t be opened.'));
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

function fieldLabelOf(d: FieldPlanDocument): string {
  return d.fieldName ? `${d.fieldName} (${d.splitId})` : `Split ${d.splitId}`;
}

/** The fields (by split) that have a report or ledger among these documents, by name. */
function fieldsOf(docs: FieldPlanDocument[]): { splitId: string; label: string }[] {
  const fields = new Map<string, string>();
  for (const d of docs) if (d.splitId && SECTION.get(d.documentType)?.perField && !fields.has(d.splitId)) fields.set(d.splitId, fieldLabelOf(d));
  return [...fields].map(([splitId, label]) => ({ splitId, label })).sort((a, b) => a.label.localeCompare(b.label));
}
