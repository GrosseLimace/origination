import { Component, input } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  host: { 'class': 'block' },
  template: `<div [class]="'scoular-card ' + class()"><ng-content /></div>`
})
export class CardComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-header',
  standalone: true,
  template: `<div [class]="'scoular-card-header ' + class()"><ng-content /></div>`
})
export class CardHeaderComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-title',
  standalone: true,
  template: `<h3 [class]="'scoular-card-title text-slate-900 dark:text-white ' + class()"><ng-content /></h3>`
})
export class CardTitleComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-description',
  standalone: true,
  template: `<p [class]="'scoular-card-subtitle text-slate-500 dark:text-slate-400 ' + class()"><ng-content /></p>`
})
export class CardDescriptionComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-content',
  standalone: true,
  template: `<div [class]="'scoular-card-body ' + class()"><ng-content /></div>`
})
export class CardContentComponent {
  public class = input<string>('');
}

@Component({
  selector: 'app-card-footer',
  standalone: true,
  template: `<div [class]="'scoular-card-footer ' + class()"><ng-content /></div>`
})
export class CardFooterComponent {
  public class = input<string>('');
}
