import { Pipe, PipeTransform } from '@angular/core';
import { commodityChipClass } from '@shared/utils/commodity-color';

/** Template form of commodityChipClass: the pastel chip classes for a crop name. Pure, so a chip
 *  resolves its classes once and again only when its crop name changes. */
@Pipe({ name: 'commodityChipClass', standalone: true, pure: true })
export class CommodityChipClassPipe implements PipeTransform {
  transform(crop: string | null | undefined): string {
    return commodityChipClass(crop);
  }
}
