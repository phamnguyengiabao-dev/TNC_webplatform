import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from './catalog.service';
import { notSeenCutoff } from './catalog.policy';

export interface SyncPolicyResult {
  hidden: number;
  restored: number;
}

/**
 * Ghi kết quả của policy hiển thị xuống DB sau mỗi lần sync.
 *
 * Read path (CatalogService.visibleWhere) đã tự suy ra trạng thái đúng, nên
 * lớp này không phải nguồn sự thật - nó tồn tại để:
 *   1. visibility = HIDDEN_BY_SYNC là dữ liệu thật, staff nhìn thấy trong màn
 *      vận hành và biết vì sao sản phẩm biến mất khỏi showroom;
 *   2. khi item quay lại bán được, sản phẩm tự hiện lại không cần thao tác.
 *
 * Sản phẩm bị staff unpublish (DRAFT) không bao giờ bị lớp này chạm tới.
 */
@Injectable()
export class CatalogAvailabilityService {
  private readonly logger = new Logger(CatalogAvailabilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async applySyncPolicy(shopId: string): Promise<SyncPolicyResult> {
    const now = new Date();
    const cutoff = notSeenCutoff(now, this.catalog.hideAfterDays);

    const hidden = await this.prisma.product.updateMany({
      where: {
        visibility: 'PUBLISHED',
        shopeeItem: {
          is: {
            shopId,
            OR: [
              { itemStatus: { in: ['BANNED', 'DELETED'] } },
              { itemStatus: 'NOT_SEEN', lastSeenAt: { lt: cutoff } },
            ],
          },
        },
      },
      data: { visibility: 'HIDDEN_BY_SYNC' },
    });

    const restored = await this.prisma.product.updateMany({
      where: {
        visibility: 'HIDDEN_BY_SYNC',
        shopeeItem: { is: { shopId, itemStatus: { in: ['NORMAL', 'UNLIST'] } } },
      },
      data: { visibility: 'PUBLISHED' },
    });

    if (hidden.count > 0 || restored.count > 0) {
      this.logger.log(
        `sync policy on shop ${shopId}: hid ${hidden.count} product(s), restored ${restored.count}`,
      );
    }
    return { hidden: hidden.count, restored: restored.count };
  }
}
