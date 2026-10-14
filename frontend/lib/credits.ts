import raw from '@/public/assets/credits.json';

export interface ImageCredit {
  file: string;
  title: string;
  credit: string;
  page: string;
  licenseCode: string;
}

/**
 * Ảnh tư liệu lấy từ các bộ sưu tập mở (Wikimedia Commons, MET) - không phải
 * ảnh sản phẩm của TNC. Giấy phép và nguồn được ghi kèm ở footer.
 */
export const IMAGE_CREDITS: ImageCredit[] = raw.map((entry) => ({
  file: entry.file.replace(/^public\//, '/'),
  title: entry.title,
  credit: entry.credit,
  page: entry.page,
  licenseCode: entry.licenseCode,
}));

export function creditFor(file: string): ImageCredit | undefined {
  return IMAGE_CREDITS.find((entry) => entry.file.endsWith(file));
}
