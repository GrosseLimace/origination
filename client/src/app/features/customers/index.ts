// Public API of the Customers module: the only file another module may import from it. eslint.config.js enforces that,
// and which modules may import it at all.
export { CustomerStore } from './data-access/customer.store';
export { CustomersApiService } from './data-access/customers-api.service';
export type { CustomerTradeUnit } from './data-access/customers-api.service';
