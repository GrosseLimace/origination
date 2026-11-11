// Public API of the Customers module: the only file another module may import from it. eslint.config.js enforces that,
// and which modules may import it at all.
export { CustomerStore } from './data-access/customer.store';
export { CustomersApiService } from './data-access/customers-api.service';
export type { CustomerTradeUnit } from './data-access/customers-api.service';

// Producers linked to the trade units' customers from outside them, and each producer's linked group: Engagement reads
// the group's notes and last-contacted dates.
export { LinkedProducersStore } from './data-access/linked-producers.store';
