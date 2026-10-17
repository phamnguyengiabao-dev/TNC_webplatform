import type { Metadata } from 'next';

import { SocialMediaAdmin } from './social-media-admin';

export const metadata: Metadata = { title: 'Quản lý thư viện ảnh' };

export default function SocialMediaAdminPage() {
  return <SocialMediaAdmin />;
}
