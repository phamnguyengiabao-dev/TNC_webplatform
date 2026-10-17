'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { SocialMediaItemView } from '@/lib/types';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/+$/, '');
type Profile = { role: string; email: string | null };

export function SocialMediaAdmin() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<SocialMediaItemView[]>([]);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [filter, setFilter] = useState<'ALL' | SocialMediaItemView['visibility']>('PENDING');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) void verifyAdmin(token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verifyAdmin(token: string) {
    setError('');
    try {
      const response = await fetch(`${API_URL}/me`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || body.role !== 'ADMIN') {
        setSessionToken(null); setProfile(null);
        setError('Tài khoản này không có quyền ADMIN. Hãy đăng nhập bằng tài khoản quản trị.');
        return;
      }
      setSessionToken(token); setProfile({ role: body.role, email: body.email });
      await loadItems(token, filter);
    } catch {
      setError('Không kết nối được máy chủ. Kiểm tra API rồi thử lại.');
    }
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setError('Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY trong frontend/.env.local.'); setLoading(false); return; }
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError || !data.session) { setError('Đăng nhập không thành công. Kiểm tra email và mật khẩu.'); return; }
    setPassword('');
    await verifyAdmin(data.session.access_token);
  }

  async function loadItems(token = sessionToken, visibility = filter) {
    if (!token) return;
    setLoading(true); setError('');
    try {
      const suffix = visibility === 'ALL' ? '' : `?visibility=${visibility}`;
      const response = await fetch(`${API_URL}/admin/social-media${suffix}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(problemText(body.code));
      setItems(body.items ?? []);
      setSelections(Object.fromEntries((body.items ?? []).map((item: SocialMediaItemView) => [item.id, item.selectedMediaUrls ?? []])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được thư viện.');
    } finally { setLoading(false); }
  }

  async function sync() {
    if (!sessionToken) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API_URL}/admin/social-media/sync`, {
        method: 'POST', headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: '{}',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(problemText(body.code));
      setMessage(`Đã đồng bộ ${body.stats.receivedRows} bài đăng · thêm ${body.stats.created} · cập nhật ${body.stats.updated}.`);
      await loadItems();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Đồng bộ chưa thành công.'); }
    finally { setLoading(false); }
  }

  async function setVisibility(id: string, visibility: SocialMediaItemView['visibility']) {
    if (!sessionToken) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API_URL}/admin/social-media/${id}/visibility`, {
        method: 'PATCH', headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ visibility, selectedMediaUrls: selections[id] ?? [] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(problemText(body.code));
      setMessage(visibility === 'PUBLIC' ? 'Ảnh đã xuất hiện trong thư viện công khai.' : 'Đã ẩn ảnh khỏi thư viện công khai.');
      await loadItems();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không cập nhật được trạng thái ảnh.'); }
    finally { setLoading(false); }
  }

  async function signOut() {
    await getSupabaseBrowserClient()?.auth.signOut();
    setSessionToken(null); setProfile(null); setItems([]); setMessage('Đã đăng xuất.');
  }

  if (!sessionToken) {
    return (
      <section className="shelf min-h-[65vh] py-14" aria-labelledby="admin-login-title">
        <div className="max-w-xl">
          <h1 id="admin-login-title" className="font-display text-title">Đăng nhập quản trị thư viện</h1>
          <p className="mt-4 text-body text-ink-soft">Chỉ tài khoản có role ADMIN mới được đồng bộ và duyệt ảnh.</p>
          <form onSubmit={signIn} className="mt-10 space-y-6">
            <label className="block text-note" htmlFor="admin-email">Email quản trị
              <input id="admin-email" className="mt-2 block min-h-12 w-full rounded-none bg-field-soft px-4 text-body" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="block text-note" htmlFor="admin-password">Mật khẩu
              <input id="admin-password" className="mt-2 block min-h-12 w-full rounded-none bg-field-soft px-4 text-body" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error && <p className="text-note text-red-800" role="alert">{error}</p>}
            <Button type="submit" disabled={loading}>{loading ? 'Đang xác thực…' : 'Đăng nhập'}</Button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="shelf pb-24 pt-10" aria-labelledby="admin-gallery-title">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><h1 id="admin-gallery-title" className="font-display text-title">Thư viện ảnh mạng xã hội</h1><p className="mt-3 text-note text-ink-soft">{profile?.email} · ADMIN</p></div>
        <div className="flex flex-wrap gap-3"><Button variant="surface" onClick={signOut}>Đăng xuất</Button><Button onClick={sync} disabled={loading}>{loading ? 'Đang xử lý…' : 'Đồng bộ Facebook & Instagram'}</Button></div>
      </div>
      <p className="mt-6 max-w-reading text-body text-ink-soft">Ảnh mới được xếp vào hàng chờ. Chọn công khai để đưa lên trang thư viện của khách.</p>
      <div className="mt-10 flex flex-wrap items-center gap-3" role="group" aria-label="Lọc ảnh theo trạng thái">
        {(['PENDING', 'PUBLIC', 'HIDDEN', 'ALL'] as const).map((value) => <button key={value} className={`min-h-11 px-4 text-note ${filter === value ? 'bg-ink text-paper' : 'bg-field text-ink'}`} aria-pressed={filter === value} onClick={() => { setFilter(value); void loadItems(sessionToken, value); }}>{filterLabel(value)}</button>)}
      </div>
      {message && <p className="mt-5 text-note" role="status">{message}</p>}
      {error && <div className="mt-5 flex flex-wrap items-center gap-4" role="alert"><p className="text-note text-red-800">{error}</p><button className="link-underline text-note" onClick={() => void loadItems()}>Thử tải lại</button></div>}
      {loading && items.length === 0 ? <ul className="social-admin-grid mt-10" aria-label="Đang tải thư viện" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((item) => <li key={item} className="aspect-[4/5] bg-field" />)}</ul> : items.length ? (
        <ul className="social-admin-grid mt-10">
          {items.map((item) => <li key={item.id} className="min-w-0">
            <div className="social-admin-images">
              {item.mediaUrls.map((url, index) => <label key={url} className="block cursor-pointer">
                <div className="social-gallery-image"><img src={url} alt={`${item.caption?.slice(0, 90) || 'Ảnh từ Meta'} · ảnh ${index + 1}`} loading="lazy" /></div>
                <span className="mt-2 flex min-h-11 items-center gap-2 text-note"><input type="checkbox" checked={(selections[item.id] ?? []).includes(url)} onChange={(event) => setSelections((current) => ({ ...current, [item.id]: event.target.checked ? [...new Set([...(current[item.id] ?? []), url])] : (current[item.id] ?? []).filter((selected) => selected !== url) }))} /><span>Chọn ảnh này</span></span>
              </label>)}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-note"><span>{item.platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'}</span><span>{filterLabel(item.visibility)}</span></div>
            {item.caption && <p className="mt-2 line-clamp-3 text-note">{item.caption}</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              {item.permalink && <a href={item.permalink} target="_blank" rel="noreferrer noopener" className="link-underline inline-flex min-h-11 items-center text-note">Mở bài gốc</a>}
              {item.visibility !== 'PUBLIC' && <Button size="sm" onClick={() => void setVisibility(item.id, 'PUBLIC')} disabled={loading || !(selections[item.id]?.length)}>Công khai ảnh đã chọn</Button>}
              {item.visibility === 'PUBLIC' && <Button size="sm" onClick={() => void setVisibility(item.id, 'PUBLIC')} disabled={loading || !(selections[item.id]?.length)}>Lưu lựa chọn</Button>}
              {item.visibility !== 'HIDDEN' && <Button variant="surface" size="sm" onClick={() => void setVisibility(item.id, 'HIDDEN')} disabled={loading}>Ẩn ảnh</Button>}
            </div>
          </li>)}
        </ul>
      ) : !error ? <section className="mt-14 bg-field-soft px-6 py-10"><h2 className="font-display text-title">Chưa có ảnh trong mục này</h2><p className="mt-3 text-body text-ink-soft">Đồng bộ tài khoản Meta để lấy bài đăng mới hoặc đổi bộ lọc.</p><button className="link-underline mt-5 text-note" onClick={() => void loadItems()} disabled={loading}>Tải lại thư viện</button></section> : null}
    </section>
  );
}

function filterLabel(value: 'ALL' | SocialMediaItemView['visibility']) {
  return ({ ALL: 'Tất cả', PENDING: 'Chờ duyệt', PUBLIC: 'Đang công khai', HIDDEN: 'Đã ẩn' } as const)[value];
}
function problemText(code: string | undefined) {
  return ({ META_NOT_CONNECTED: 'Chưa cấu hình kết nối Meta trong backend.', SYNC_ALREADY_RUNNING: 'Đang có một lần đồng bộ chạy.', FORBIDDEN: 'Tài khoản không có quyền quản trị.', UNAUTHENTICATED: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' } as Record<string, string>)[code ?? ''] ?? 'Thao tác chưa thành công. Vui lòng thử lại.';
}
