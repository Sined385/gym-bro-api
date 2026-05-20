import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { TemplateService } from '../home/template.service';
import { CommunityService } from '../community/community.service';
import { SharedCardsService } from './share-cards.service';

@Controller()
@Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
export class ShareController {
  constructor(
    private readonly templateService: TemplateService,
    private readonly configService: ConfigService,
    private readonly communityService: CommunityService,
    private readonly sharedCardsService: SharedCardsService,
  ) {}

  @Get('api/v1/shared/templates/:code')
  @HttpCode(HttpStatus.OK)
  async getSharedTemplate(@Param('code') code: string) {
    return this.templateService.getSharedTemplate(code);
  }

  @Get('s/:code')
  async webFallback(@Param('code') code: string, @Res() res: Response) {
    let template: any;
    try {
      template = await this.templateService.getSharedTemplate(code);
    } catch {
      res.status(404).send(this.notFoundHtml('Workout'));
      return;
    }

    const exerciseList = (template.exercises || [])
      .map(
        (e: any) =>
          `<li style="padding:8px 0;border-bottom:1px solid #f0f0f0"><strong>${this.escapeHtml(e.name)}</strong> <span style="color:#888">· ${this.escapeHtml(e.muscleGroup || '')} · ${this.escapeHtml(e.setsDisplay || '')}</span></li>`,
      )
      .join('');

    const creatorName = template.creator?.name || 'A GymJam user';
    const title = `${this.escapeHtml(template.name)} — shared by ${this.escapeHtml(creatorName)}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <meta property="og:title" content="${this.escapeHtml(template.name)}">
  <meta property="og:description" content="Shared by ${this.escapeHtml(creatorName)} — ${template.exercises.length} exercises. Open in GymJam to start this workout.">
  <meta property="og:type" content="website">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;color:#2d3240;padding:24px;max-width:480px;margin:0 auto}
    .card{background:#fff;border-radius:20px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.06);margin-top:16px}
    .creator{font-size:14px;color:#888;margin-bottom:4px}
    h1{font-size:22px;margin-bottom:16px}
    ul{list-style:none}
    .cta{display:block;text-align:center;margin-top:24px;padding:14px;background:linear-gradient(135deg,#E86A75,#d4525e);color:#fff;border-radius:14px;text-decoration:none;font-weight:700;font-size:16px}
    .sub{text-align:center;margin-top:12px;font-size:13px;color:#888}
  </style>
</head>
<body>
  <div class="card">
    <p class="creator">Shared by ${this.escapeHtml(creatorName)}</p>
    <h1>${this.escapeHtml(template.name)}</h1>
    <ul>${exerciseList}</ul>
  </div>
  <a class="cta" href="https://apps.apple.com/app/gymjam/id6744136857">Open in GymJam</a>
  <p class="sub">Don't have the app? Download it free on the App Store.</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('p/:postId')
  async postWebFallback(@Param('postId') postId: string, @Res() res: Response) {
    const result = await this.communityService.getPostPublic(postId);
    if (!result) {
      res.status(404).send(this.notFoundHtml('Post'));
      return;
    }

    const { post, user } = result;
    const authorName = user?.full_name ?? 'A GymJam user';
    const contentPreview = post.content
      ? this.escapeHtml(post.content.substring(0, 200))
      : 'Check out this post on GymJam';
    const title = `${this.escapeHtml(authorName)} on GymJam`;
    // Prefer the rasterized share card (9:16, branded) when present; fall
    // back to the raw user photo for legacy posts. Both unfurl as og:image.
    const previewImage =
      (post as any).card_image_url ?? post.photo_url ?? null;
    const ogImage = previewImage
      ? `<meta property="og:image" content="${this.escapeHtml(previewImage)}">
  <meta property="og:image:width" content="1080">
  <meta property="og:image:height" content="1920">
  <meta name="twitter:card" content="summary_large_image">`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${contentPreview}">
  <meta property="og:type" content="website">
  ${ogImage}
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;color:#2d3240;padding:24px;max-width:480px;margin:0 auto}
    .preview{display:block;width:100%;aspect-ratio:9/16;border-radius:20px;object-fit:cover;box-shadow:0 4px 16px rgba(0,0,0,0.08);margin-top:16px;background:#ececf0}
    .card{background:#fff;border-radius:20px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.06);margin-top:16px}
    .author{font-size:14px;color:#888;margin-bottom:4px}
    .content{font-size:16px;line-height:1.5;margin-top:8px}
    .cta{display:block;text-align:center;margin-top:24px;padding:14px;background:linear-gradient(135deg,#E86A75,#d4525e);color:#fff;border-radius:14px;text-decoration:none;font-weight:700;font-size:16px}
    .sub{text-align:center;margin-top:12px;font-size:13px;color:#888}
  </style>
</head>
<body>
  ${previewImage ? `<img class="preview" src="${this.escapeHtml(previewImage)}" alt="Workout share card">` : ''}
  <div class="card">
    <p class="author">${this.escapeHtml(authorName)}</p>
    <p class="content">${this.escapeHtml(post.content ?? '')}</p>
  </div>
  <a class="cta" href="https://apps.apple.com/app/gymjam/id6744136857">Open in GymJam</a>
  <p class="sub">Don't have the app? Download it free on the App Store.</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('c/:shareId')
  async sharedCardWebFallback(
    @Param('shareId') shareId: string,
    @Res() res: Response,
  ) {
    const result = await this.sharedCardsService.getSharedCardPublic(shareId);
    if (!result) {
      res.status(404).send(this.notFoundHtml('Share'));
      return;
    }
    const { card, user } = result;
    const authorName = user?.full_name ?? 'A GymJam user';
    const username = user?.username ?? '';
    const avatarUrl = user?.avatar_url ?? null;
    const initial = (authorName.trim().charAt(0) || 'G').toUpperCase();
    const title = `${this.escapeHtml(authorName)} on GymJam`;
    const description = 'Check out this workout on GymJam.';

    const ogImage = `<meta property="og:image" content="${this.escapeHtml(card.card_image_url)}">
  <meta property="og:image:width" content="1080">
  <meta property="og:image:height" content="1920">
  <meta name="twitter:card" content="summary_large_image">`;

    const avatarBlock = avatarUrl
      ? `<img class="avatar-img" src="${this.escapeHtml(avatarUrl)}" alt="">`
      : `<div class="avatar-fallback">${this.escapeHtml(initial)}</div>`;

    const handleLine = username
      ? `<p class="handle">@${this.escapeHtml(username)}</p>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  ${ogImage}
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;color:#2d3240;padding:24px;max-width:480px;margin:0 auto}
    .preview{display:block;width:100%;aspect-ratio:9/16;border-radius:20px;object-fit:cover;box-shadow:0 4px 16px rgba(0,0,0,0.08);margin-top:16px;background:#ececf0}
    .author-row{display:flex;align-items:center;gap:12px;background:#fff;border-radius:20px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06);margin-top:16px}
    .avatar-img,.avatar-fallback{width:44px;height:44px;border-radius:50%;flex-shrink:0;object-fit:cover}
    .avatar-fallback{background:linear-gradient(135deg,#E86A75,#d4525e);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px}
    .author-meta{min-width:0;flex:1}
    .name{font-size:16px;font-weight:700;color:#2d3240}
    .handle{font-size:13px;color:#888;margin-top:2px}
    .cta{display:block;text-align:center;margin-top:16px;padding:14px;background:linear-gradient(135deg,#E86A75,#d4525e);color:#fff;border-radius:14px;text-decoration:none;font-weight:700;font-size:16px}
    .sub{text-align:center;margin-top:12px;font-size:13px;color:#888}
  </style>
</head>
<body>
  <img class="preview" src="${this.escapeHtml(card.card_image_url)}" alt="Workout share card">
  <div class="author-row">
    ${avatarBlock}
    <div class="author-meta">
      <p class="name">${this.escapeHtml(authorName)}</p>
      ${handleLine}
    </div>
  </div>
  <a class="cta" href="https://apps.apple.com/app/gymjam/id6744136857">Open in GymJam</a>
  <p class="sub">Don't have the app? Download it free on the App Store.</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('.well-known/apple-app-site-association')
  @SkipThrottle()
  async aasa(@Res() res: Response) {
    const aasa = {
      applinks: {
        apps: [],
        details: [
          {
            appIDs: [
              'YNXC5CY44T.com.den.gymbro.app',
              'YNXC5CY44T.com.den.gymbro.app.staging',
            ],
            paths: ['/s/*', '/p/*', '/c/*'],
          },
        ],
      },
    };
    res.setHeader('Content-Type', 'application/json');
    res.json(aasa);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private notFoundHtml(type = 'Workout'): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title>
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 24px;color:#2d3240}h1{font-size:24px}p{color:#888;margin-top:8px}</style>
</head>
<body><h1>${type} not found</h1><p>This share link may have expired or been removed.</p></body>
</html>`;
  }
}
