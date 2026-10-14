/**
 * URL slug generation for showroom products.
 *
 * Vietnamese titles are the norm here ("Son MAC Chili - 95%"), so diacritics
 * are stripped rather than percent-encoded: a slug is part of the public URL
 * and has to stay readable and copy-pasteable.
 */
const FALLBACK_SLUG = 'san-pham';
const MAX_SLUG_LENGTH = 80;

export function slugify(input: string): string {
  const ascii = input
    .normalize('NFD')
    // Combining marks: covers à á ả ã ạ, â, ê, ô, ơ, ư, ă...
    .replace(/[\u0300-\u036f]/g, '')
    // `đ`/`Đ` is a distinct letter, not a base + mark, so NFD leaves it alone.
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (ascii.length === 0) return FALLBACK_SLUG;
  if (ascii.length <= MAX_SLUG_LENGTH) return ascii;
  return ascii.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
}

/**
 * Appends `-2`, `-3`... until the slug is free. `taken` answers "is this slug
 * already used by someone else?" so the caller stays in charge of uniqueness
 * (a DB unique index remains the real guarantee; this only avoids the
 * collision in the common case).
 */
export async function uniqueSlug(
  base: string,
  taken: (candidate: string) => Promise<boolean>,
  maxAttempts = 50,
): Promise<string> {
  const root = slugify(base);
  for (let suffix = 1; suffix <= maxAttempts; suffix += 1) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`could not find a free slug for "${root}" after ${maxAttempts} attempts`);
}
