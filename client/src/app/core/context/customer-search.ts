import { Observable } from 'rxjs';
import { Customer } from '@models';

/**
 * Searching customers by name, which the Customers module owns. Declared in core because Help's troubleshooter, in
 * core, searches too; the Customers module's CustomersApiService is the implementation, which the composition root
 * provides.
 */
export abstract class CustomerSearch {
  /** Our customers whose name matches, at most 15; only those in the trade units, when any are given. */
  abstract searchCustomers(searchTerm: string, tradeUnits?: string[]): Observable<Customer[]>;
  /**
   * The ODS customer master's customers whose name matches and who aren't in our tables yet: the onboarding fallback.
   * It never fails: a failed search finds no one.
   */
  abstract searchOdsCustomers(searchTerm: string): Observable<Customer[]>;
}
