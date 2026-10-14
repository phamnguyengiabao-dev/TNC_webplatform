import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('strips Vietnamese diacritics and keeps the words readable', () => {
    expect(slugify('Son MAC Chili - 95% còn lại')).toBe('son-mac-chili-95-con-lai');
  });

  it('maps đ/Đ to d', () => {
    expect(slugify('Sữa rửa mặt Đông Y')).toBe('sua-rua-mat-dong-y');
  });

  it('collapses punctuation runs into a single dash', () => {
    expect(slugify('Serum  ABC /// 30ml  (2)')).toBe('serum-abc-30ml-2');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  ...Kem nền...  ')).toBe('kem-nen');
  });

  it('falls back when nothing survives', () => {
    expect(slugify('♥♥♥')).toBe('san-pham');
  });

  it('caps the length and never ends on a dash', () => {
    const slug = slugify(`${'a'.repeat(79)} bcd`);
    expect(slug).toHaveLength(79);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('returns the base slug when it is free', async () => {
    await expect(uniqueSlug('Son MAC', async () => false)).resolves.toBe('son-mac');
  });

  it('suffixes until the slug is free', async () => {
    const taken = new Set(['son-mac', 'son-mac-2']);
    const slug = await uniqueSlug('Son MAC', async (candidate) => taken.has(candidate));
    expect(slug).toBe('son-mac-3');
  });
});
