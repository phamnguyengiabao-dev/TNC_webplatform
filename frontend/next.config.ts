import type { NextConfig } from 'next';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo gốc cũng có package-lock.json, nên Next phải được chỉ rõ gốc workspace:
// nếu không nó suy ra từ lockfile của repo cha và cảnh báo sai.
const workspaceRoot = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  images: {
    // Ảnh sản phẩm mirror từ Shopee về Supabase Storage khi sync (S4); trong
    // lúc chờ, ảnh CDN Shopee được phép để showroom không bị vỡ ảnh.
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'cf.shopee.vn' },
      { protocol: 'https', hostname: 'down-vn.img.susercontent.com' },
    ],
  },
};

export default config;
