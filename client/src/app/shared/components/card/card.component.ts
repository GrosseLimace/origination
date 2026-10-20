import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'class': 'block' },
  template: `<div [class]="'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm ' + class()"><ng-content /></div>`
})
export class CardComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div [class]="'flex flex-col gap-1.5 p-6 ' + class()"><ng-content /></div>`
})
export class CardHeaderComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-title',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h3 [class]="'text-lg font-semibold leading-none tracking-tight text-gray-900 dark:text-white ' + class()"><ng-content /></h3>`
})
export class CardTitleComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-description',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p [class]="'text-sm text-gray-500 dark:text-gray-400 ' + class()"><ng-content /></p>`
})
export class CardDescriptionComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-content',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div [class]="'p-6 pt-0 ' + class()"><ng-content /></div>`
})
export class CardContentComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div [class]="'flex items-center p-6 pt-0 ' + class()"><ng-content /></div>`
})
export class CardFooterComponent {
  public class = input<string>('');
}
