import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SocialMediaPlatform, SocialMediaVisibility, SyncRunStatus } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

type MediaDraft = {
  platform: SocialMediaPlatform;
  externalId: string;
  caption: string | null;
  mediaType: string;
  mediaUrls: string[];
  permalink: string | null;
  publishedAt: Date | null;
  raw: Prisma.InputJsonObject;
};

type GraphResponse = { data?: unknown[]; paging?: { next?: string }; error?: { message?: string } };

@Injectable()
export class MetaSocialSyncService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async listPublic() {
    const rows = await this.prisma.socialMediaItem.findMany({
      where: { visibility: 'PUBLIC' }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 60,
    });
    return { items: rows.map((row) => toView(row, true)) };
  }

  async listAdmin(visibility?: SocialMediaVisibility) {
    const rows = await this.prisma.socialMediaItem.findMany({
      where: visibility ? { visibility } : {},
      orderBy: [{ visibility: 'asc' }, { publishedAt: 'desc' }, { id: 'desc' }], take: 100,
    });
    return { items: rows.map((row) => toView(row)) };
  }

  async setVisibility(id: string, visibility: SocialMediaVisibility, actorId: string, selectedMediaUrls?: string[]) {
    const row = await this.prisma.$transaction(async (tx) => {
      const prior = await tx.socialMediaItem.findUnique({ where: { id }, select: { visibility: true, mediaUrls: true, selectedMediaUrls: true } });
      if (!prior) throw AppError.notFound(`social media item ${id} not found`);
      const available = stringList(prior.mediaUrls);
      const selected = selectedMediaUrls ?? stringList(prior.selectedMediaUrls);
      if (selected.some((url) => !available.includes(url))) {
        throw AppError.validation('selected social images must belong to the synced post', 'Có ảnh được chọn không thuộc bài đăng này.');
      }
      if (visibility === 'PUBLIC' && selected.length === 0) {
        throw AppError.validation('publishing requires at least one selected image', 'Chọn ít nhất một ảnh trước khi công khai.');
      }
      const updated = await tx.socialMediaItem.update({
        where: { id }, data: { visibility, selectedMediaUrls: selected, reviewedBy: actorId, reviewedAt: new Date() },
      });
      await tx.auditLog.create({ data: {
        entityType: 'SOCIAL_MEDIA_ITEM', entityId: id, action: 'SET_VISIBILITY',
        oldStatus: prior.visibility, newStatus: visibility, actorId, actorRole: 'ADMIN',
      } });
      return updated;
    });
    return toView(row);
  }

  async sync(actorId: string) {
    const accessToken = this.config.get<string>('meta.accessToken', '').trim();
    const pageId = this.config.get<string>('meta.facebookPageId', '').trim();
    const instagramId = this.config.get<string>('meta.instagramAccountId', '').trim();
    if (!accessToken || (!pageId && !instagramId)) {
      throw new AppError('META_NOT_CONNECTED', {
        logMessage: 'Meta social sync requires META_ACCESS_TOKEN and at least one account id',
        detail: 'Chưa cấu hình Meta Page/Instagram và access token ở backend.',
      });
    }

    const active = await this.prisma.syncRun.findFirst({ where: { provider: 'META', status: 'RUNNING' }, orderBy: { startedAt: 'desc' } });
    if (active && Date.now() - active.startedAt.getTime() < 30 * 60 * 1000) {
      throw new AppError('SYNC_ALREADY_RUNNING', { detail: 'Đang có một lần đồng bộ Meta chạy.' });
    }
    if (active) {
      await this.prisma.$transaction([
        this.prisma.syncError.create({ data: { runId: active.id, code: 'STALE_RUN', message: 'Sync Meta quá thời gian cho phép.' } }),
        this.prisma.syncRun.update({ where: { id: active.id }, data: { status: 'FAILED', finishedAt: new Date(), stats: { errors: 1 } } }),
      ]);
    }

    const run = await this.prisma.syncRun.create({
      data: { provider: 'META', mode: 'FULL', status: 'RUNNING', startedBy: actorId }, select: { id: true },
    });
    let received = 0;
    let created = 0;
    let updated = 0;
    try {
      const drafts = [
        ...(pageId ? await this.fetchFacebook(pageId, accessToken) : []),
        ...(instagramId ? await this.fetchInstagram(instagramId, accessToken) : []),
      ];
      received = drafts.length;
      for (const draft of drafts) {
        const prior = await this.prisma.socialMediaItem.findUnique({
          where: { platform_externalId: { platform: draft.platform, externalId: draft.externalId } },
          select: { id: true },
        });
        await this.prisma.socialMediaItem.upsert({
          where: { platform_externalId: { platform: draft.platform, externalId: draft.externalId } },
          create: { ...draft, mediaUrls: draft.mediaUrls, lastSeenAt: new Date() },
          update: {
            caption: draft.caption, mediaType: draft.mediaType, mediaUrls: draft.mediaUrls,
            permalink: draft.permalink, publishedAt: draft.publishedAt, raw: draft.raw, lastSeenAt: new Date(),
          },
        });
        if (prior) updated += 1; else created += 1;
      }
      const stats = { receivedRows: received, created, updated, errors: 0 };
      await this.prisma.syncRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', stats, finishedAt: new Date() } });
      return { runId: run.id, status: 'SUCCEEDED' as SyncRunStatus, stats };
    } catch (error) {
      await this.prisma.syncError.create({ data: {
        runId: run.id, code: 'META_SYNC_FAILED', message: safeMessage(error),
      } }).catch(() => undefined);
      await this.prisma.syncRun.update({
        where: { id: run.id }, data: { status: 'FAILED', stats: { receivedRows: received, created, updated, errors: 1 }, finishedAt: new Date() },
      });
      if (error instanceof AppError) throw error;
      throw AppError.internal(`Meta social sync run ${run.id} failed`, error);
    }
  }

  private async fetchFacebook(pageId: string, token: string): Promise<MediaDraft[]> {
    const fields = 'id,message,permalink_url,full_picture,created_time,attachments{media_type,media,subattachments}';
    const posts = await this.fetchPages(`/${encodeURIComponent(pageId)}/published_posts`, fields, token);
    return arrayOfRecords(posts).flatMap((post) => {
      const attachments = asRecord(post.attachments)?.data;
      const urls = unique([
        ...attachmentUrls(attachments),
        typeof post.full_picture === 'string' ? post.full_picture : null,
      ]);
      if (!urls.length) return [];
      return [{
        platform: 'FACEBOOK' as const, externalId: stringValue(post.id),
        caption: nullableString(post.message), mediaType: 'PHOTO', mediaUrls: urls,
        permalink: nullableString(post.permalink_url), publishedAt: parseDate(post.created_time), raw: post as Prisma.InputJsonObject,
      }];
    }).filter((item) => item.externalId.length > 0);
  }

  private async fetchInstagram(accountId: string, token: string): Promise<MediaDraft[]> {
    const fields = 'id,caption,media_type,media_url,permalink,timestamp,thumbnail_url,children{data{id,media_type,media_url,thumbnail_url}}';
    const media = await this.fetchPages(`/${encodeURIComponent(accountId)}/media`, fields, token);
    return arrayOfRecords(media).flatMap((item) => {
      const children = asRecord(item.children)?.data;
      const urls = unique([
        ...arrayOfRecords(children).flatMap(instagramImageUrls),
        ...instagramImageUrls(item),
      ]);
      if (!urls.length) return [];
      return [{
        platform: 'INSTAGRAM' as const, externalId: stringValue(item.id),
        caption: nullableString(item.caption), mediaType: stringValue(item.media_type) || 'PHOTO',
        mediaUrls: urls, permalink: nullableString(item.permalink),
        publishedAt: parseDate(item.timestamp), raw: item as Prisma.InputJsonObject,
      }];
    }).filter((item) => item.externalId.length > 0);
  }

  private async fetchPages(path: string, fields: string, token: string): Promise<unknown[]> {
    const version = this.config.get<string>('meta.graphVersion', 'v26.0');
    const base = `https://graph.facebook.com/${version}${path}`;
    const url = new URL(base);
    url.searchParams.set('fields', fields);
    url.searchParams.set('limit', '100');
    const items: unknown[] = [];
    for (let page = 0; page < 20 && url; page += 1) {
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
      const payload = await response.json() as GraphResponse;
      if (!response.ok || payload.error) {
        throw new Error(`Meta Graph API: ${payload.error?.message ?? `HTTP ${response.status}`}`);
      }
      if (Array.isArray(payload.data)) items.push(...payload.data);
      const next = payload.paging?.next;
      if (!next) break;
      const nextUrl = new URL(next);
      if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== 'graph.facebook.com' || !nextUrl.pathname.startsWith(`/${version}/`)) {
        throw new Error('Meta pagination returned an unexpected URL');
      }
      url.href = nextUrl.href;
      if (page === 19) throw new Error('Meta pagination exceeded 20 pages');
    }
    return items;
  }
}

function toView(row: { id: string; platform: SocialMediaPlatform; externalId: string; caption: string | null; mediaType: string; mediaUrls: unknown; selectedMediaUrls: unknown; permalink: string | null; publishedAt: Date | null; visibility: SocialMediaVisibility; lastSeenAt: Date }, publicOnly = false) {
  const mediaUrls = stringList(row.mediaUrls);
  const selectedMediaUrls = stringList(row.selectedMediaUrls);
  return {
    id: row.id, platform: row.platform, externalId: row.externalId, caption: row.caption,
    mediaType: row.mediaType, mediaUrls: publicOnly ? selectedMediaUrls : mediaUrls, selectedMediaUrls,
    permalink: row.permalink, publishedAt: row.publishedAt?.toISOString() ?? null,
    visibility: row.visibility, lastSeenAt: row.lastSeenAt.toISOString(),
  };
}
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function arrayOfRecords(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : []; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function parseDate(value: unknown): Date | null { if (typeof value !== 'string') return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function unique(values: (string | null)[]): string[] { return [...new Set(values.filter((value): value is string => !!value && /^https:\/\//.test(value)))]; }
function mediaUrlList(value: Record<string, unknown>): (string | null)[] {
  const media = asRecord(value.media); const image = asRecord(media?.image);
  return [nullableString(value.media_url), nullableString(value.thumbnail_url), nullableString(image?.src), nullableString(media?.source)];
}
function attachmentUrls(value: unknown): (string | null)[] {
  return arrayOfRecords(value).flatMap((entry) => {
    if (['video', 'reel'].includes(stringValue(entry.media_type).toLowerCase())) return [];
    const media = asRecord(entry.media); const image = asRecord(media?.image);
    const children = asRecord(entry.subattachments)?.data;
    return [nullableString(image?.src), nullableString(media?.source), ...arrayOfRecords(children).flatMap((child) => mediaUrlList(child))];
  });
}
function instagramImageUrls(item: Record<string, unknown>): (string | null)[] {
  const type = stringValue(item.media_type).toUpperCase();
  if (type === 'VIDEO' || type === 'REELS') return [nullableString(item.thumbnail_url)];
  return [nullableString(item.media_url), nullableString(item.thumbnail_url)];
}
function safeMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : 'Unknown Meta sync error'; }
