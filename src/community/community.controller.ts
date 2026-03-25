import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CommunityService } from './community.service';
import { CommunityAiService } from './community-ai.service';
import {
  CreatePostDto,
  CreateCommentDto,
  FeedQueryDto,
  FollowUserDto,
} from './dto/community.dto';

@Controller('api/v1/community')
@UseGuards(AuthGuard)
export class CommunityController {
  constructor(
    private readonly communityService: CommunityService,
    private readonly communityAiService: CommunityAiService,
  ) {}

  // ── Feed ──────────────────────────────────────────────────

  @Get('feed')
  @HttpCode(HttpStatus.OK)
  async getFeed(@Query() query: FeedQueryDto, @Req() req: Request) {
    return this.communityService.getFeed(req.user!.id, query);
  }

  // ── Posts ─────────────────────────────────────────────────

  @Post('posts')
  @HttpCode(HttpStatus.CREATED)
  async createPost(@Body() dto: CreatePostDto, @Req() req: Request) {
    return this.communityService.createPost(req.user!.id, dto);
  }

  @Delete('posts/:id')
  @HttpCode(HttpStatus.OK)
  async deletePost(@Param('id') postId: string, @Req() req: Request) {
    return this.communityService.deletePost(req.user!.id, postId);
  }

  // ── Likes ─────────────────────────────────────────────────

  @Post('posts/:id/like')
  @HttpCode(HttpStatus.OK)
  async toggleLike(@Param('id') postId: string, @Req() req: Request) {
    return this.communityService.toggleLike(req.user!.id, postId);
  }

  // ── Comments ──────────────────────────────────────────────

  @Get('posts/:id/comments')
  @HttpCode(HttpStatus.OK)
  async getComments(
    @Param('id') postId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.communityService.getComments(postId, cursor, limit);
  }

  @Post('posts/:id/comments')
  @HttpCode(HttpStatus.CREATED)
  async createComment(
    @Param('id') postId: string,
    @Body() dto: CreateCommentDto,
    @Req() req: Request,
  ) {
    return this.communityService.createComment(req.user!.id, postId, dto);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.OK)
  async deleteComment(@Param('id') commentId: string, @Req() req: Request) {
    return this.communityService.deleteComment(req.user!.id, commentId);
  }

  // ── Follow ──────────────────────────────────────────────

  @Post('follow')
  @HttpCode(HttpStatus.CREATED)
  async followUser(@Body() dto: FollowUserDto, @Req() req: Request) {
    return this.communityService.followUser(req.user!.id, dto.userId);
  }

  @Delete('follow/:userId')
  @HttpCode(HttpStatus.OK)
  async unfollowUser(@Param('userId') userId: string, @Req() req: Request) {
    return this.communityService.unfollowUser(req.user!.id, userId);
  }

  // ── My Profile ───────────────────────────────────────────

  @Get('me/profile')
  @HttpCode(HttpStatus.OK)
  async getMyProfile(@Req() req: Request) {
    return this.communityService.getMyProfile(req.user!.id);
  }

  // ── User Profiles ─────────────────────────────────────────

  @Get('users/:userId/profile')
  @HttpCode(HttpStatus.OK)
  async getUserProfile(
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    return this.communityService.getUserProfile(req.user!.id, userId);
  }

  @Get('users/:userId/compare')
  @HttpCode(HttpStatus.OK)
  async compareWithUser(
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    return this.communityAiService.compareUsers(req.user!.id, userId);
  }
}
