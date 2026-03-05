# Angular Style Guide

Use the following guidelines for writing Angular applications.

## Minimum Version Requirements

| Technology   | Minimum Version | Notes                             |
| ------------ | --------------- | --------------------------------- |
| Angular      | 21+             | Do NOT use Angular 20 or earlier  |
| Tailwind CSS | v4+             | Do NOT use Tailwind v3 or earlier |

If `ng new` or any CLI defaults to an older version, explicitly specify the correct version flag. Never silently create a project on an older major version — upgrading after the fact is costly.

## General Guidelines

- Use standalone components
- Follow the official [Angular Style Guide](https://angular.dev/style-guide)
- Use Angular CLI for project scaffolding and generation
- Provide comprehensive testing with Vitest

## Reference Style Guides

This guide builds upon and references:

- **[Angular Official Style Guide](https://angular.dev/style-guide)** — Primary reference
- **[Google HTML/CSS Style Guide](https://google.github.io/styleguide/htmlcssguide.html)** — For templates
- **[Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)** — For TypeScript code
- **[Google JSON Style Guide](https://google.github.io/styleguide/jsoncstyleguide.xml)** — For configuration files

## Environment Setup

Use npm or yarn as the package manager:

```bash
# Create new project
ng new project-name

# Install Tailwind CSS
npm install tailwindcss @tailwindcss/postcss postcss --save-dev

# Development server
ng serve --open
```

> **Note:** Angular defaults to strict mode, routing enabled, standalone architecture, Vitest, and CSS for stylesheets. The build system uses esbuild via `@angular/build`. See the [Tailwind CSS Setup](#tailwind-css-setup) section for PostCSS configuration.

For each project, provide a `package.json` with clearly defined dependencies and scripts.

## File and Folder Structure

```text
src/
├── app/
│   ├── core/                    # Singleton services, guards, interceptors
│   │   ├── services/
│   │   ├── guards/
│   │   └── interceptors/
│   ├── shared/                  # Shared components, directives, pipes
│   │   ├── components/
│   │   ├── directives/
│   │   ├── pipes/
│   │   └── utils/
│   ├── features/                # Feature areas
│   │   ├── feature-a/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── services/
│   │   │   └── models/
│   │   └── feature-b/
│   ├── models/                  # Shared interfaces and types
│   └── app.component.ts
├── assets/
├── environments/
└── styles/
```

## Naming Conventions

### Files

- **Components**: `feature-name.component.ts` (kebab-case)
- **Services**: `feature-name.service.ts`
- **Models/Interfaces**: `feature-name.model.ts`
- **Pipes**: `feature-name.pipe.ts`
- **Directives**: `feature-name.directive.ts`
- **Guards**: `feature-name.guard.ts`
- **Spec files**: `feature-name.component.spec.ts`

### Classes and Symbols

- **Components**: PascalCase with `Component` suffix (e.g., `UserListComponent`)
- **Services**: PascalCase with `Service` suffix (e.g., `UserService`)
- **Interfaces**: PascalCase, no prefix (e.g., `User`, `UserResponse`)
- **Pipes**: PascalCase with `Pipe` suffix (e.g., `DateFormatPipe`)
- **Directives**: PascalCase with `Directive` suffix (e.g., `HighlightDirective`)
- **Guards**: camelCase function (e.g., `authGuard`). Export a named function, not a class.
- **Enums**: PascalCase (e.g., `UserRole`)

### Variables and Functions

- **Variables**: camelCase (e.g., `userName`, `isLoading`)
- **Functions/Methods**: camelCase (e.g., `getUserById`, `handleClick`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRY_COUNT`, `API_BASE_URL`)
- **Private members**: Prefix with underscore (e.g., `_privateMethod`)
- **Observables**: Suffix with `$` (e.g., `users$`, `isLoading$`)
- **Signals**: No special suffix (e.g., `users`, `isLoading`)

## TypeScript Style

### Indentation and Formatting

- **Indentation**: 2 spaces (Angular convention)
- **Line length**: 120 characters max
- **String literals**: Single quotes (`'`) for strings
- **Template literals**: Use backticks for string interpolation
- **Semicolons**: Required

### Type Annotations

Always provide explicit types:

```typescript
// ✅ Good
public userName: string = '';
public users: User[] = [];
public getUserById(id: number): Observable<User> { }

// ❌ Bad
public userName = '';  // Implicit type
public getUserById(id) { }  // Missing types
```

### Interface Definitions

```typescript
// Define interfaces in separate .model.ts files
export interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt?: Date;  // Optional property
}

export interface UserResponse {
  data: User;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

## Component Style

### Component Structure

```typescript
import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { UserService } from '../../services/user.service';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.css']
})
export class UserListComponent {
  // 1. Dependency injection
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);

  // 2. Signals
  public users = signal<User[]>([]);
  public isLoading = signal<boolean>(false);
  public errorMessage = signal<string | null>(null);

  // 3. Constructor — initialization
  constructor() {
    this.loadUsers();
  }

  // 4. Public methods
  public onUserSelect(user: User): void {
    // Handle user selection
  }

  public onRefresh(): void {
    this.loadUsers();
  }

  // 5. Private methods
  private loadUsers(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.userService.getUsers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (users) => {
          this.users.set(users);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.errorMessage.set('Failed to load users');
          this.isLoading.set(false);
        }
      });
  }
}
```

### Signal-Based Inputs and Outputs

Use signal-based APIs for component communication:

```typescript
import { Component, input, output, model, computed } from '@angular/core';

@Component({
  selector: 'app-user-card',
  templateUrl: './user-card.component.html'
})
export class UserCardComponent {
  // Required input — compile error if parent doesn't provide it
  public user = input.required<User>();

  // Optional input with default
  public showEmail = input<boolean>(false);

  // Derived value from input — replaces ngOnChanges
  public fullName = computed(() => `${this.user().firstName} ${this.user().lastName}`);

  // Output event
  public userSelected = output<User>();

  public onSelect(): void {
    this.userSelected.emit(this.user());
  }
}
```

For two-way binding, use `model()`:

```typescript
@Component({
  selector: 'app-toggle',
  template: `<button (click)="toggle()">{{ checked() ? 'On' : 'Off' }}</button>`
})
export class ToggleComponent {
  // Writable signal with two-way binding support
  public checked = model<boolean>(false);

  public toggle(): void {
    this.checked.update(v => !v);
  }
}
// Parent usage: <app-toggle [(checked)]="isEnabled" />
```

For derived writable state that resets when a source changes, use `linkedSignal()`:

```typescript
import { signal, linkedSignal } from '@angular/core';

public selectedUser = signal<User | null>(null);
// Resets when selectedUser changes, but can be manually overridden
public selectedTab = linkedSignal(() => this.selectedUser() ? 'details' : 'list');
```

### Component Best Practices

1. **Keep components small and focused** — Single responsibility principle
2. **Zoneless change detection** — Signals drive reactivity. Use signals for all reactive state.
3. **Use `takeUntilDestroyed()`** for observable cleanup — from `@angular/core/rxjs-interop`
4. **Use signals for component state** — `signal()`, `computed()`, `linkedSignal()`
5. **Delegate complex logic to services**
6. **Use signal-based inputs and outputs** — `input()`, `output()`, and `model()`
7. **For data fetching**, consider `toSignal()`, `rxResource`, or `httpResource` in addition to manual subscribe. See [Angular Data Fetching Patterns](angular-data-fetching-patterns.md) for detailed comparisons.
8. **Use external template files** — Always use `templateUrl` instead of inline `template`, except for components with very simple, single-element templates.

## Service Style

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';

import { User, PaginatedResponse } from '../models/user.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/users`;

  // ---------------------------------------------------------
  public getUsers(page: number = 1, pageSize: number = 10): Observable<PaginatedResponse<User>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('pageSize', pageSize.toString());

    return this.http.get<PaginatedResponse<User>>(this.apiUrl, { params })
      .pipe(catchError(this.handleError));
  }

  // ---------------------------------------------------------
  public getUserById(id: number): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/${id}`)
      .pipe(catchError(this.handleError));
  }

  // ---------------------------------------------------------
  public createUser(user: Partial<User>): Observable<User> {
    return this.http.post<User>(this.apiUrl, user)
      .pipe(catchError(this.handleError));
  }

  // ---------------------------------------------------------
  public updateUser(id: number, user: Partial<User>): Observable<User> {
    return this.http.put<User>(`${this.apiUrl}/${id}`, user)
      .pipe(catchError(this.handleError));
  }

  // ---------------------------------------------------------
  public deleteUser(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`)
      .pipe(catchError(this.handleError));
  }

  // ---------------------------------------------------------
  private handleError(error: any): Observable<never> {
    console.error('API Error:', error);
    return throwError(() => new Error(error.message || 'Server error'));
  }
}
```

## Template Style

### HTML Best Practices

```html
<!-- user-list.component.html -->

<section class="p-4">
  <header class="flex justify-between items-center mb-4">
    <h2 class="text-lg font-semibold text-slate-900 dark:text-white">Users</h2>
    <button class="scoular-btn scoular-btn-primary" (click)="onRefresh()" [disabled]="isLoading()">
      Refresh
    </button>
  </header>

  <!-- Loading state -->
  @if (isLoading()) {
    <div class="flex justify-center py-6">
      <span class="scoular-spinner"></span>
    </div>
  }

  <!-- Error state -->
  @if (errorMessage(); as error) {
    <div class="scoular-alert scoular-alert-error" role="alert">
      <div class="scoular-alert-description">{{ error }}</div>
    </div>
  }

  <!-- Content -->
  @if (!isLoading() && !errorMessage()) {
    <ul class="divide-y divide-slate-200 dark:divide-slate-700">
      @for (user of users(); track user.id) {
        <li class="flex justify-between py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
            (click)="onUserSelect(user)">
          <span class="font-medium text-slate-900 dark:text-white">{{ user.firstName }} {{ user.lastName }}</span>
          <span class="text-slate-500 dark:text-slate-400">{{ user.email }}</span>
        </li>
      } @empty {
        <li class="text-center text-slate-400 dark:text-slate-500 py-6">No users found</li>
      }
    </ul>
  }
</section>
```

### Template Guidelines

1. **Use built-in control flow** (`@if`, `@for`, `@switch`) — do not use structural directives (`*ngIf`, `*ngFor`, `*ngSwitch`)
2. **Always provide `track`** for `@for` loops
3. **Use semantic HTML elements** (`section`, `article`, `header`, etc.)
4. **Keep templates simple** — Complex logic belongs in the component
5. **Use Tailwind utilities** for layout and spacing, **`scoular-*` design system classes** for branded elements

## Tailwind CSS Setup

Add a `.postcssrc.json` file in the project root:

```json
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

> **Note:** Angular's build system picks up `.postcssrc.json` automatically — no additional config needed.

Import the design system and Tailwind in `src/styles.css`:

```css
@import '@it/design-system';
@import "tailwindcss";
```

**The import order matters.** The design system must come first so that `@theme`, `@custom-variant`, and `@apply` directives are processed correctly by Tailwind's PostCSS plugin. See the `@it/design-system` README for full documentation.

### Styling Approach

Use `@it/design-system` component classes (`scoular-*` prefix) for branded, reusable UI elements. Use Tailwind utility classes directly in templates for layout, spacing, and one-off styling. The design system is a pure CSS package — no framework dependency.

### Design System Classes

The `@it/design-system` package provides all reusable component classes with the `scoular-` prefix. Do **not** define custom button, badge, form, or card classes in `src/styles.css` — use the design system classes instead.

#### Buttons

Buttons require a base class plus a variant class:

```html
<button class="scoular-btn scoular-btn-primary">Save</button>
<button class="scoular-btn scoular-btn-secondary">Cancel</button>
<button class="scoular-btn scoular-btn-success">Approve</button>
<button class="scoular-btn scoular-btn-warning">Caution</button>
<button class="scoular-btn scoular-btn-danger">Delete</button>
<button class="scoular-btn scoular-btn-info">Details</button>
<button class="scoular-btn scoular-btn-outline">Outline</button>
<button class="scoular-btn scoular-btn-ghost">Ghost</button>

<!-- Sizes -->
<button class="scoular-btn scoular-btn-primary scoular-btn-sm">Small</button>
<button class="scoular-btn scoular-btn-primary scoular-btn-lg">Large</button>

<!-- Icon button -->
<button class="scoular-btn-icon">...</button>
```

#### Cards

```html
<div class="scoular-card">
  <div class="scoular-card-header">
    <h3 class="scoular-card-title text-slate-900 dark:text-white">Title</h3>
    <p class="scoular-card-subtitle text-slate-500 dark:text-slate-400">Description</p>
  </div>
  <div class="scoular-card-body">Content here</div>
  <div class="scoular-card-footer">Footer</div>
</div>
```

> **Important:** `scoular-card-title` and `scoular-card-subtitle` intentionally do not set text color. Always provide color via Tailwind utility classes (e.g., `text-slate-900 dark:text-white`). This avoids CSS specificity conflicts — see [CSS Layers](#css-layers--specificity).

#### Forms

```html
<div class="scoular-form-group">
  <label class="scoular-form-label">Name</label>
  <input class="scoular-form-input h-10" placeholder="Enter value" />
</div>

<select class="scoular-form-select h-10">...</select>
<textarea class="scoular-form-textarea"></textarea>

<!-- Error state -->
<input class="scoular-form-input error" />
<p class="scoular-form-error">This field is required</p>

<!-- Helper text -->
<p class="scoular-form-helper">Optional helper text</p>
```

#### Badges

```html
<span class="scoular-badge scoular-badge-success">Active</span>
<span class="scoular-badge scoular-badge-warning">Pending</span>
<span class="scoular-badge scoular-badge-error">Overdue</span>
<span class="scoular-badge scoular-badge-info">Info</span>
<span class="scoular-badge scoular-badge-neutral">Draft</span>
```

#### Tables, Alerts, Modals, and More

The design system includes many additional components. See the `@it/design-system` README for the full reference:

| Category | Classes |
|---|---|
| Tables | `scoular-table`, `scoular-table-striped`, `scoular-table-compact` |
| Alerts | `scoular-alert`, `scoular-alert-success`, `-warning`, `-error`, `-info` |
| Modals | `scoular-modal`, `scoular-modal-overlay`, `-header`, `-body`, `-footer` |
| Navigation | `scoular-nav-item` |
| Tabs | `scoular-tabs`, `scoular-tab` |
| Spinners | `scoular-spinner`, `scoular-spinner-sm`, `scoular-spinner-lg` |
| Dropdowns | `scoular-dropdown`, `scoular-dropdown-item` |
| Pagination | `scoular-pagination`, `scoular-pagination-item` |
| Stat Cards | `scoular-stat-card`, `scoular-stat-label`, `scoular-stat-value` |

### CSS Layers & Specificity

The design system CSS is imported **before** `@import "tailwindcss"`, which means:

- **Design system classes** (`scoular-*`) compile as **unlayered CSS**
- **Tailwind utilities** (`text-*`, `bg-*`, etc.) compile inside `@layer utilities`
- Per the CSS cascade, **unlayered CSS always beats layered CSS**

This is why `scoular-card-title` and `scoular-card-subtitle` deliberately omit text color. If they included `color` via `@apply`, no Tailwind utility could override it. Instead, always provide text colors via utility classes in your HTML so overrides work naturally.

```html
<!-- Default title color via utilities -->
<h3 class="scoular-card-title text-slate-900 dark:text-white">Normal Title</h3>

<!-- Override color via utilities -->
<h3 class="scoular-card-title text-scoular-red-dark dark:text-scoular-red">Alert Title</h3>
```

### Brand Colors

All colors match the **October 2020 Scoular Brand Guide** and are available as Tailwind utilities and CSS custom properties:

| Color | Tailwind Class | CSS Variable |
|---|---|---|
| Blue (Primary) | `bg-scoular-blue` | `var(--scoular-blue)` |
| Blue Dark | `bg-scoular-blue-dark` | `var(--scoular-blue-dark)` |
| Dark Blue | `bg-scoular-dark-blue` | `var(--scoular-dark-blue)` |
| Yellow | `bg-scoular-yellow` | `var(--scoular-yellow)` |
| Green | `bg-scoular-green` | `var(--scoular-green)` |
| Red | `bg-scoular-red` | `var(--scoular-red)` |
| Teal | `bg-scoular-teal` | `var(--scoular-teal)` |
| Gray | `bg-scoular-gray` | `var(--scoular-gray)` |
| Cream | `bg-scoular-cream` | `var(--scoular-cream)` |

All colors work with Tailwind modifiers: `text-scoular-blue`, `border-scoular-red/20`, `hover:bg-scoular-green`, etc.

Semantic color variants for component states:

- **Success** → `scoular-green` (not emerald)
- **Warning** → `scoular-yellow` (not amber)
- **Danger/Error** → `scoular-red` (not red-500)
- **Info** → `scoular-teal` (not sky)

### Dark Mode

Add the `dark` class to your `<html>` or `<body>` element:

```html
<html class="dark">
```

All `scoular-*` classes and Tailwind `dark:` variants respond automatically. Semantic CSS custom properties (`--color-text-primary`, `--color-background`, etc.) also switch values in dark mode.

### Template Usage

Use Tailwind utilities for layout and one-off styling. Use `scoular-*` design system classes for branded elements:

```html
<!-- Tailwind utilities for layout, design system classes for components -->
<section class="p-4">
  <header class="flex justify-between items-center mb-4">
    <h2 class="text-lg font-semibold text-slate-900 dark:text-white">Users</h2>
    <!-- Design system button class -->
    <button class="scoular-btn scoular-btn-primary" (click)="onRefresh()" [disabled]="isLoading()">
      Refresh
    </button>
  </header>

  @if (isLoading()) {
    <div class="flex justify-center py-6">
      <span class="scoular-spinner"></span>
    </div>
  }

  @if (errorMessage(); as error) {
    <div class="scoular-alert scoular-alert-error" role="alert">
      <div class="scoular-alert-description">{{ error }}</div>
    </div>
  }

  @if (!isLoading() && !errorMessage()) {
    <ul class="divide-y divide-slate-200 dark:divide-slate-700">
      @for (user of users(); track user.id) {
        <li class="flex justify-between py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
            (click)="onUserSelect(user)">
          <span class="font-medium text-slate-900 dark:text-white">{{ user.firstName }} {{ user.lastName }}</span>
          <span class="text-slate-500 dark:text-slate-400">{{ user.email }}</span>
        </li>
      } @empty {
        <li class="text-center text-slate-400 dark:text-slate-500 py-6">No users found</li>
      }
    </ul>
  }
</section>
```

### Component-Scoped CSS

Use component CSS files only when you need styles that are truly specific to one component and don't belong in the design system or global stylesheet:

```css
/* user-list.component.css */
:host {
  display: block;
}
```

Most styling should be handled through Tailwind utilities in the template or `scoular-*` design system classes.

### Styling Guidelines

1. **Use `scoular-*` design system classes** for all branded, reusable UI elements (buttons, inputs, cards, badges, tables, alerts, etc.)
2. **Use Tailwind utilities** directly in templates for layout, spacing, and one-off styling
3. **Always provide text color via utilities** on elements where the design system omits it (e.g., `scoular-card-title`) to avoid CSS specificity conflicts
4. **Use Scoular brand colors** (`scoular-blue`, `scoular-green`, `scoular-red`, etc.) — not generic Tailwind colors — for semantic meaning
5. **Support dark mode** with `dark:` variants on Tailwind utilities; `scoular-*` classes handle dark mode automatically
6. **Minimize component-scoped CSS** — only use when truly component-specific
7. **Do not redefine design system classes** in `src/styles.css` — extend with Tailwind utilities in the template instead

## Testing

### Component Testing

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

import { UserListComponent } from './user-list.component';
import { UserService } from '../../services/user.service';

describe('UserListComponent', () => {
  let component: UserListComponent;
  let fixture: ComponentFixture<UserListComponent>;
  let userServiceMock: { getUsers: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    userServiceMock = {
      getUsers: vi.fn().mockReturnValue(of([]))
    };

    await TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UserService, useValue: userServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserListComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load users on init', () => {
    fixture.detectChanges();
    expect(userServiceMock.getUsers).toHaveBeenCalled();
  });

  it('should display loading state', () => {
    component.isLoading.set(true);
    fixture.detectChanges();

    const loadingElement = fixture.nativeElement.querySelector('.scoular-spinner');
    expect(loadingElement).toBeTruthy();
  });
});
```

## Imports Order

Organize imports in this order:

1. Angular core imports
2. Angular common/forms/router imports
3. Third-party library imports (RxJS, Angular Material, etc.)
4. Application core imports (services, guards)
5. Application shared imports (components, pipes)
6. Feature-specific imports
7. Models and interfaces

```typescript
// 1. Angular core
import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// 2. Angular forms/router
import { ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

// 3. Third-party
import { debounceTime } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';

// 4. Core services
import { UserService } from '@core/services/user.service';
import { AuthService } from '@core/services/auth.service';

// 5. Shared components
import { LoadingSpinnerComponent } from '@shared/components/loading-spinner.component';

// 6. Feature-specific
import { UserCardComponent } from './components/user-card.component';

// 7. Models
import { User, UserRole } from '@models/user.model';
```

## Error Handling

```typescript
// Create custom error types
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Global error handler
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly logger = inject(LoggingService);
  private readonly notifier = inject(NotificationService);

  handleError(error: Error): void {
    this.logger.error('Unhandled error', error);

    if (error instanceof ApiError) {
      this.notifier.showError(`API Error: ${error.message}`);
    } else {
      this.notifier.showError('An unexpected error occurred');
    }
  }
}
```

## Change Detection

Angular uses zoneless change detection. Signals drive change detection — when a signal value changes, Angular knows exactly which views need updating.

- Use signals (`signal()`, `computed()`, `input()`, `model()`) for all reactive state
- Use `afterNextRender()` for one-time DOM operations after first render
- Use `afterEveryRender()` for repeated DOM operations after each render cycle

```typescript
import { Component, afterNextRender, afterEveryRender, ElementRef, inject } from '@angular/core';

@Component({...})
export class ChartComponent {
  private readonly elementRef = inject(ElementRef);

  constructor() {
    // Runs once after the component's first render
    afterNextRender(() => {
      this.initializeChart(this.elementRef.nativeElement);
    });

    // Runs after every render cycle
    afterEveryRender(() => {
      this.updateChartDimensions();
    });
  }
}
```

## Performance Best Practices

1. **Zoneless change detection** — Signals drive reactivity. Angular only re-renders views affected by signal changes.
2. **Lazy load routes** with `loadComponent` for faster initial load:
   ```typescript
   { path: 'admin', loadComponent: () => import('./admin.component').then(m => m.AdminComponent) }
   ```
3. **Use `track` in `@for` loops** for efficient DOM updates
4. **Avoid function calls in templates** — Use pipes or `computed()` signals
5. **Use `takeUntilDestroyed()`** or `rxResource`/`toSignal()` which handle cleanup automatically
6. **Use signals and resources** instead of manual subscriptions when possible
7. **Use `afterNextRender()` and `afterEveryRender()`** for DOM-dependent operations

---

*Style Guide Version: 2.0*
*Last Updated: February 2026*
*Based on Angular 21 with standalone components and zoneless change detection*
