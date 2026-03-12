import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '@shared/components/header/header.component';
import { FooterComponent } from '@shared/components/footer/footer.component';
import { ToastContainerComponent } from '@shared/components/toast-container/toast-container.component';
import { IdleTimeoutService } from '@core/services/idle-timeout.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ToastContainerComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  constructor() {
    inject(IdleTimeoutService).start();
  }
}
