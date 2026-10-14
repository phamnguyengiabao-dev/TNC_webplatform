#!/usr/bin/env node
'use strict';

/**
 * Dữ liệu mẫu cho môi trường dev (S3 - showroom catalog).
 *
 * Vì sao cần: `/san-pham` và trang chủ chỉ đọc từ `GET /catalog/*`, nên muốn
 * soi giao diện bằng dữ liệu thật thì phải có sản phẩm thật trong DB. Seed này
 * dựng thẳng `ShopeeShop` + `ShopeeItem` + `Product` như thể một lần sync vừa
 * chạy xong, thay vì phải upload file CSV mỗi lần.
 *
 * Chạy: npm run dev:seed   (sau khi `npm run dev:db` đã migrate)
 *
 * Idempotent: upsert theo (shopeeShopId, itemId) và slug nên chạy lại nhiều lần
 * vẫn ra đúng một bộ dữ liệu.
 */

const { PrismaClient } = require('@prisma/client');

const DEFAULT_URL = 'postgresql://postgres@127.0.0.1:55433/tnc_dev';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_URL;
process.env.DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const prisma = new PrismaClient();

/** Gian hàng Shopee của TNC (số giả - chỉ dùng cho deep-link dev). */
const SHOP = { shopeeShopId: 221107349n, name: 'TNC Beauty Official Store', region: 'vn' };

/**
 * Ảnh sản phẩm trong dev lấy từ `frontend/public/assets` (ảnh tư liệu mở) để
 * không phụ thuộc CDN Shopee khi ngồi soi giao diện. Production mirror ảnh thật
 * về Supabase Storage trong bước sync.
 */
const PHOTO = {
  facePowder: '/assets/tangee-face-powder.jpg',
  perfume: '/assets/perfume-bottles.jpg',
  inlayTable: '/assets/dressing-table-inlaid-with-ebony-ivory-v.jpg',
  compact: '/assets/compact-powder-am-1995-202-34-2.jpg',
  mirror: '/assets/dressing-table-mirror.jpg',
  makeupTable: '/assets/makeup-table1886.jpg',
  lipstick: '/assets/violetta-lipstick.jpg',
};

const CERTIFIED = {
  authenticity: 'verified',
  inspectedBy: 'Kho TNC',
  inspectedAt: '2026-10-12',
};

/**
 * Mỗi entry là một món trên kệ: `product` là cửa sổ trưng bày của showroom,
 * `item` là bản mirror của Shopee (nguồn duy nhất của giá/tồn/trạng thái bán).
 * `item: null` = món pre-loved ký gửi không có listing riêng -> `buyUrlOverride`.
 */
const ENTRIES = [
  // ---------------------------------------------------------------------
  // Pristine Retail - hàng mới, còn nguyên seal
  // ---------------------------------------------------------------------
  {
    slug: 'son-mac-matte-lipstick-chili-3g',
    collection: 'pristine-retail',
    title: 'Son MAC Matte Lipstick - Chili 3g',
    blurb:
      'Tông đỏ gạch trầm huyền thoại của MAC: lì mịn, lên màu đậm chỉ sau một lượt quẹt, hợp cả da sáng và da ngăm.',
    sealStatus: 'sealed',
    conditionPercent: null,
    badges: ['Nguyên seal'],
    qaNotes: {
      sterilized: 'Không cần - sản phẩm còn nguyên seal nhà máy',
      origin: 'Nhập khẩu chính ngạch, kèm hoá đơn VAT',
      ...CERTIFIED,
      expiresOn: '03/2029',
      batchCode: 'A24K03',
    },
    featuredRank: null,
    visibility: 'PUBLISHED',
    daysAgo: 1,
    item: {
      itemId: '22110734901',
      itemName: 'Son MAC Matte Lipstick Chili 3g chính hãng',
      price: '520000',
      stock: 24,
      imageUrls: [PHOTO.facePowder, PHOTO.lipstick],
    },
  },
  {
    slug: 'son-ysl-rouge-volupte-shine-95',
    collection: 'curated-preloved',
    title: 'Son YSL Rouge Volupté Shine - còn 95%',
    blurb:
      'Chỉ quẹt thử hai lần rồi cất tủ, thân son còn đầy. Vỏ hộp giấy móp nhẹ một góc do vận chuyển, thân son không xước.',
    sealStatus: 'swatched',
    conditionPercent: 95,
    badges: ['Hộp móp nhẹ'],
    qaNotes: {
      sterilized: 'Lau cồn 70 độ phần đầu son + chiếu UV-C 15 phút',
      origin: 'Khách ký gửi, còn hoá đơn mua tại Lotte',
      ...CERTIFIED,
      authenticity: 'receipt-checked',
      expiresOn: '08/2027',
      batchCode: '62W200',
      inspectedBy: 'Ngọc Anh',
    },
    featuredRank: null,
    visibility: 'PUBLISHED',
    daysAgo: 2,
    item: {
      itemId: '22110734905',
      itemName: 'Son YSL Rouge Volupte Shine 95% - ký gửi TNC',
      price: '690000',
      stock: 1,
      imageUrls: [PHOTO.lipstick, PHOTO.makeupTable],
    },
  },
  {
    slug: 'nuoc-hoa-dior-sauvage-edp-100ml',
    collection: 'pristine-retail',
    title: 'Nước hoa Dior Sauvage EDP 100ml',
    blurb:
      'Bản Eau de Parfum nồng độ cao, lưu hương trên da 8-10 giờ. Hộp và chai còn nguyên niêm phong của nhà phân phối.',
    sealStatus: 'sealed',
    conditionPercent: null,
    badges: ['Nguyên seal', 'Fullbox'],
    qaNotes: {
      sterilized: 'Không cần - còn nguyên niêm phong',
      origin: 'Nhà phân phối uỷ quyền tại Việt Nam',
      ...CERTIFIED,
      expiresOn: '05/2030',
      batchCode: '6B01',
    },
    featuredRank: null,
    visibility: 'PUBLISHED',
    daysAgo: 3,
    item: {
      itemId: '22110734902',
      itemName: 'Nước hoa Dior Sauvage EDP 100ml fullbox',
      price: '3350000',
      stock: 5,
      imageUrls: [PHOTO.perfume, PHOTO.mirror],
    },
  },
  {
    slug: 'vien-phan-nuoc-sulwhasoo-perfecting-70',
    collection: 'curated-preloved',
    title: 'Viên phán nước Sulwhasoo Perfecting - còn 70%',
    blurb:
      'Dùng được khoảng một phần ba hộp, lõi cushion đã thay mới. Kèm vỏ case gốc và một lõi refill chưa bóc.',
    sealStatus: 'opened',
    conditionPercent: 70,
    badges: ['Kèm lõi refill'],
    qaNotes: {
      sterilized: 'Vệ sinh vỏ case + khay lõi bằng dung dịch khử khuẩn',
      origin: 'Khách ký gửi, mua tại duty-free sân bay',
      ...CERTIFIED,
      authenticity: 'receipt-checked',
      expiresOn: '11/2027',
      batchCode: 'S25W07',
    },
    featuredRank: 1,
    visibility: 'PUBLISHED',
    daysAgo: 4,
    item: {
      itemId: '22110734906',
      itemName: 'Cushion Sulwhasoo Perfecting 70% kèm refill',
      price: '590000',
      stock: 1,
      imageUrls: [PHOTO.compact, PHOTO.inlayTable],
    },
  },
  {
    slug: 'kem-duong-la-mer-creme-de-la-mer-30ml',
    collection: 'pristine-retail',
    title: 'Kem dưỡng La Mer Crème de la Mer 30ml',
    blurb:
      'Hũ nhỏ để bắt đầu với kem dưỡng đặc trưng của La Mer. Còn nguyên màng niêm phong dưới nắp và hộp ngoài.',
    sealStatus: 'sealed',
    conditionPercent: null,
    badges: ['Nguyên seal'],
    qaNotes: {
      sterilized: 'Không cần - còn nguyên seal nhà máy',
      origin: 'Nhập khẩu chính ngạch, kèm hoá đơn VAT',
      ...CERTIFIED,
      expiresOn: '01/2029',
      batchCode: 'L24A11',
    },
    // Ba món này lên "kệ nổi bật" của trang chủ; chúng khác bộ "mới nhất" để
    // trang chủ luôn trưng được sáu món thay vì ba.
    featuredRank: 2,
    visibility: 'PUBLISHED',
    daysAgo: 5,
    item: {
      itemId: '22110734903',
      itemName: 'Kem dưỡng La Mer Crème de la Mer 30ml',
      price: '5200000',
      stock: 2,
      imageUrls: [PHOTO.inlayTable, PHOTO.mirror],
    },
  },
  {
    slug: 'serum-lancome-advanced-genifique-30ml-80',
    collection: 'curated-preloved',
    title: 'Serum Lancôme Advanced Génifique 30ml - còn 80%',
    blurb:
      'Pipette còn khoảng bốn phần năm chai, dùng dở và bảo quản trong ngăn mát. Nắp vặn còn khít, không rạn.',
    sealStatus: 'opened',
    conditionPercent: 80,
    badges: ['Bảo quản ngăn mát'],
    qaNotes: {
      sterilized: 'Lau cồn 70 độ đầu pipette, tránh để hở nắp',
      origin: 'Khách ký gửi, mua tại Sephora Singapore',
      ...CERTIFIED,
      expiresOn: '06/2027',
      batchCode: '40W302',
    },
    visibility: 'PUBLISHED',
    daysAgo: 6,
    item: {
      itemId: '22110734907',
      itemName: 'Serum Lancome Advanced Genifique 30ml 80%',
      price: '780000',
      stock: 1,
      imageUrls: [PHOTO.mirror, PHOTO.perfume],
    },
  },
  {
    slug: 'phan-phu-mac-studio-fix-plus-12g',
    collection: 'pristine-retail',
    title: 'Phấn phủ MAC Studio Fix Powder Plus 12g',
    blurb:
      'Hai tông phổ biến nhất còn sẵn trên kệ: NC20 và NC25. Phấn nén còn nguyên, gương và bông đi kèm chưa mở.',
    sealStatus: 'sealed',
    conditionPercent: null,
    badges: ['Nguyên seal', 'Còn 2 tông'],
    qaNotes: {
      sterilized: 'Không cần - còn nguyên seal nhà máy',
      origin: 'Nhập khẩu chính ngạch, kèm hoá đơn VAT',
      ...CERTIFIED,
      expiresOn: '09/2029',
      batchCode: 'M24F05',
    },
    visibility: 'PUBLISHED',
    daysAgo: 7,
    item: {
      itemId: '22110734904',
      itemName: 'Phấn phủ MAC Studio Fix Powder Plus 12g',
      price: '1150000',
      priceMin: '1150000',
      priceMax: '1290000',
      stock: 8,
      hasModel: true,
      imageUrls: [PHOTO.compact, PHOTO.facePowder],
    },
  },
  {
    slug: 'bang-trang-diem-dior-backstage-85',
    collection: 'curated-preloved',
    title: 'Bảng trang điểm Dior Backstage - còn 85%',
    blurb:
      'Bảng mắt và má bản giới hạn, chỉ quẹt thử vài ô để chụp look. Màu lên đều, không bị vỡ hay bột.',
    sealStatus: 'swatched',
    conditionPercent: 85,
    badges: ['Bản giới hạn'],
    qaNotes: {
      sterilized: 'Gạt bỏ lớp phấn bề mặt ô số 2 và ô má',
      origin: 'Khách ký gửi, mua tại Dior Boutique Hà Nội',
      ...CERTIFIED,
      authenticity: 'receipt-checked',
      expiresOn: '04/2028',
      batchCode: '9F221',
    },
    featuredRank: 3,
    visibility: 'PUBLISHED',
    daysAgo: 8,
    item: {
      itemId: '22110734908',
      itemName: 'Bảng trang điểm Dior Backstage 85%',
      price: '320000',
      stock: 1,
      imageUrls: [PHOTO.makeupTable, PHOTO.compact],
    },
  },
  {
    slug: 'kem-duong-kiehls-midnight-recovery-60',
    collection: 'curated-preloved',
    title: "Kem dưỡng Kiehl's Midnight Recovery - còn 60%",
    blurb:
      'Hũ thuỷ tinh còn hơn nửa. Vì là dạng dầu dưỡng nên phần còn lại vẫn thơm mùi oải hương nguyên bản.',
    sealStatus: 'used',
    conditionPercent: 60,
    badges: ['Kèm hộp gốc'],
    qaNotes: {
      sterilized: 'Lau miệng hũ và nắp bằng cồn 70 độ, thay gioăng mới',
      origin: 'Khách ký gửi, mua tại Kiehl\u2019s Vincom',
      ...CERTIFIED,
      expiresOn: '02/2027',
      batchCode: '18U300',
    },
    visibility: 'PUBLISHED',
    daysAgo: 9,
    item: {
      itemId: '22110734909',
      itemName: "Kem dưỡng Kiehl's Midnight Recovery 60%",
      price: '450000',
      stock: 1,
      imageUrls: [PHOTO.perfume, PHOTO.inlayTable],
    },
  },
  {
    slug: 'but-ke-mat-3ce-duo-90',
    collection: 'curated-preloved',
    title: 'Bút kẻ mắt 3CE Duo - còn 90%',
    blurb:
      'Món ký gửi bán theo combo làm đẹp trên gian hàng Shopee, không có listing riêng. Bút còn gần đầy, đầu chì chưa gọt.',
    sealStatus: 'opened',
    conditionPercent: 90,
    badges: ['Bán theo combo'],
    qaNotes: {
      sterilized: 'Lau thân bút bằng cồn 70 độ, gọt vỏ đầu chì',
      origin: 'Khách ký gửi, mua tại Olive Young',
      ...CERTIFIED,
      authenticity: 'self-declared',
      expiresOn: '12/2027',
    },
    visibility: 'PUBLISHED',
    daysAgo: 10,
    buyUrlOverride: 'https://shopee.vn/product/221107349/22110734999',
    item: null,
  },
  {
    slug: 'tay-trang-bioderma-crealine-h2o-500ml',
    collection: 'pristine-retail',
    title: 'Tẩy trang Bioderma Créaline H2O 500ml',
    blurb:
      'Chai lớn dùng được vài tháng. Đợt này gian hàng đang chờ nhập thêm nên nút mua tạm đóng.',
    sealStatus: 'sealed',
    conditionPercent: null,
    badges: ['Nguyên seal'],
    qaNotes: {
      sterilized: 'Không cần - còn nguyên seal nhà máy',
      origin: 'Nhập khẩu chính ngạch, kèm hoá đơn VAT',
      ...CERTIFIED,
      expiresOn: '07/2029',
      batchCode: 'B24L02',
    },
    visibility: 'PUBLISHED',
    daysAgo: 11,
    item: {
      itemId: '22110734910',
      itemName: 'Tẩy trang Bioderma Créaline H2O 500ml',
      price: '385000',
      stock: 0,
      imageUrls: [PHOTO.mirror, PHOTO.facePowder],
    },
  },
  {
    slug: 'cushion-laneige-neo-matte-65',
    collection: 'curated-preloved',
    title: 'Cushion Laneige Neo Matte - còn 65%',
    blurb:
      'Gian hàng đang tạm gỡ listing để đổi lõi, nên món này vẫn trưng bày nhưng chưa đặt được.',
    sealStatus: 'used',
    conditionPercent: 65,
    badges: ['Tạm gỡ listing'],
    qaNotes: {
      sterilized: 'Vệ sinh vỏ case, thay mút tán mới',
      origin: 'Khách ký gửi, mua tại Laneige counter',
      ...CERTIFIED,
      expiresOn: '10/2027',
      batchCode: 'N23B08',
    },
    visibility: 'PUBLISHED',
    daysAgo: 12,
    item: {
      itemId: '22110734911',
      itemName: 'Cushion Laneige Neo Matte 65%',
      price: '410000',
      stock: 1,
      status: 'UNLIST',
      imageUrls: [PHOTO.compact, PHOTO.makeupTable],
    },
  },

  // ---------------------------------------------------------------------
  // Trạng thái biên - để thử 3 nhánh của policy (docs 2.5)
  // ---------------------------------------------------------------------
  {
    slug: 'son-3ce-velvet-lip-tint-ngung-ban',
    collection: 'curated-preloved',
    title: 'Son 3CE Velvet Lip Tint (đã ngừng bán)',
    blurb: 'Món này Shopee đã khoá vì vi phạm bản quyền bao bì. Showroom ẩn theo.',
    sealStatus: 'opened',
    conditionPercent: 80,
    badges: [],
    qaNotes: null,
    visibility: 'HIDDEN_BY_SYNC',
    daysAgo: 13,
    item: {
      itemId: '22110734912',
      itemName: 'Son 3CE Velvet Lip Tint (banned)',
      price: '260000',
      stock: 1,
      status: 'BANNED',
      imageUrls: [PHOTO.lipstick],
    },
  },
  {
    slug: 'serum-ordinary-niacinamide-90',
    collection: 'curated-preloved',
    title: 'Serum The Ordinary Niacinamide (mất khỏi nguồn sync)',
    blurb: 'Item không còn xuất hiện trong file sync quá 7 ngày, nên bị ẩn tự động.',
    sealStatus: 'opened',
    conditionPercent: 90,
    badges: [],
    qaNotes: null,
    visibility: 'HIDDEN_BY_SYNC',
    daysAgo: 14,
    item: {
      itemId: '22110734913',
      itemName: 'Serum The Ordinary Niacinamide 10% + Zinc 1%',
      price: '210000',
      stock: 1,
      status: 'NOT_SEEN',
      lastSeenDaysAgo: 12,
      imageUrls: [PHOTO.mirror],
    },
  },
  {
    slug: 'kem-chong-nang-ankesa-nhap',
    collection: 'pristine-retail',
    title: 'Kem chống nắng Ankesa (bản nháp)',
    blurb: 'Staff còn đang viết mô tả, chưa đưa lên kệ.',
    sealStatus: 'sealed',
    conditionPercent: null,
    badges: [],
    qaNotes: null,
    visibility: 'DRAFT',
    daysAgo: null,
    item: {
      itemId: '22110734914',
      itemName: 'Kem chống nắng Ankesa SPF50+ PA++++',
      price: '290000',
      stock: 6,
      imageUrls: [PHOTO.facePowder],
    },
  },
];

const DAY_MS = 86_400_000;

async function main() {
  const now = Date.now();

  const shop = await prisma.shopeeShop.upsert({
    where: { shopeeShopId: SHOP.shopeeShopId },
    create: SHOP,
    update: { name: SHOP.name, region: SHOP.region, lastSyncAt: new Date(now) },
    select: { id: true },
  });

  const collections = await prisma.collection.findMany({ select: { id: true, slug: true } });
  const collectionId = new Map(collections.map((row) => [row.slug, row.id]));

  for (const entry of ENTRIES) {
    const targetCollection = collectionId.get(entry.collection);
    if (!targetCollection) {
      throw new Error(
        `collection "${entry.collection}" chưa có trong DB - chạy \`prisma migrate deploy\` trước.`,
      );
    }

    let itemId = null;
    if (entry.item) {
      const seenAt = new Date(now - (entry.item.lastSeenDaysAgo ?? 0) * DAY_MS);
      const commerce = {
        itemName: entry.item.itemName,
        itemStatus: entry.item.status ?? 'NORMAL',
        price: entry.item.price ?? null,
        priceMin: entry.item.priceMin ?? null,
        priceMax: entry.item.priceMax ?? null,
        stock: entry.item.stock ?? null,
        hasModel: entry.item.hasModel ?? false,
        imageUrls: entry.item.imageUrls ?? [],
        lastSeenAt: seenAt,
      };

      const item = await prisma.shopeeItem.upsert({
        where: {
          shopId_itemId: { shopId: shop.id, itemId: BigInt(entry.item.itemId) },
        },
        create: {
          shopId: shop.id,
          itemId: BigInt(entry.item.itemId),
          contentHash: `seed-${entry.item.itemId}`,
          ...commerce,
        },
        update: { ...commerce, contentHash: `seed-${entry.item.itemId}` },
        select: { id: true },
      });
      itemId = item.id;
    }

    const product = {
      collectionId: targetCollection,
      shopeeItemId: itemId,
      displayTitle: entry.title,
      blurb: entry.blurb,
      conditionPercent: entry.conditionPercent ?? null,
      sealStatus: entry.sealStatus ?? null,
      qaNotes: entry.qaNotes ?? null,
      badges: entry.badges ?? [],
      visibility: entry.visibility,
      featuredRank: entry.featuredRank ?? null,
      buyUrlOverride: entry.buyUrlOverride ?? null,
      publishedAt: entry.daysAgo === null ? null : new Date(now - entry.daysAgo * DAY_MS),
    };

    await prisma.product.upsert({
      where: { slug: entry.slug },
      create: { slug: entry.slug, ...product },
      update: product,
    });
  }

  const [published, hidden, draft] = await Promise.all([
    prisma.product.count({ where: { visibility: 'PUBLISHED' } }),
    prisma.product.count({ where: { visibility: 'HIDDEN_BY_SYNC' } }),
    prisma.product.count({ where: { visibility: 'DRAFT' } }),
  ]);

  console.log(`Seed xong: ${published} món đang bán, ${hidden} món bị ẩn theo sync, ${draft} bản nháp.`);
  console.log('Showroom: http://localhost:3000/san-pham');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
