import { AUTHENTICITY_LABELS, qaLabel } from '@/lib/labels';

function renderValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (key === 'authenticity' && typeof value === 'string') {
    return AUTHENTICITY_LABELS[value] ?? value;
  }
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Khối Quality Assurance: danh sách editorial, mỗi dòng là một lời hứa cụ thể.
 * Không icon trang trí, không bảng dashboard - chỉ nhãn nhỏ và câu trả lời.
 */
export function QaList({ qa }: { qa: Record<string, unknown> | null }) {
  const rows = Object.entries(qa ?? {})
    .map(([key, value]) => ({ key, text: renderValue(key, value) }))
    .filter((row): row is { key: string; text: string } => row.text !== null);

  if (rows.length === 0) {
    return (
      <p className="text-note text-ink-soft">
        Món này đang chờ staff bổ sung thông tin kiểm định chi tiết.
      </p>
    );
  }

  return (
    <dl className="space-y-6">
      {rows.map((row) => (
        <div key={row.key} className="grid gap-1 sm:grid-cols-[13rem_1fr] sm:gap-6">
          <dt className="text-note text-ink-soft">
            {qaLabel(row.key)}
          </dt>
          <dd className="text-body leading-relaxed">{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}
