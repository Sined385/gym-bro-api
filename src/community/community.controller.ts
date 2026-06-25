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
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CommunityService } from './community.service';
import { CommunityAiService } from './community-ai.service';
import {
  CreatePostDto,
  CreateCommentDto,
  FeedQueryDto,
  FollowUserDto,
  CreateReportDto,
  BlockUserDto,
  ToggleReactionDto,
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

  @Get('posts/:id')
  @HttpCode(HttpStatus.OK)
  async getPost(@Param('id') postId: string, @Req() req: Request) {
    return this.communityService.getPostById(req.user!.id, postId);
  }

  @Delete('posts/:id')
  @HttpCode(HttpStatus.OK)
  async deletePost(@Param('id') postId: string, @Req() req: Request) {
    return this.communityService.deletePost(req.user!.id, postId);
  }

  // ── Reactions ────────────────────────────────────────────────

  @Post('posts/:id/react')
  @HttpCode(HttpStatus.OK)
  async toggleReaction(
    @Param('id') postId: string,
    @Body() dto: ToggleReactionDto,
    @Req() req: Request,
  ) {
    return this.communityService.toggleReaction(
      req.user!.id,
      postId,
      dto.emoji,
    );
  }

  // ── Comments ──────────────────────────────────────────────

  @Get('posts/:id/comments')
  @HttpCode(HttpStatus.OK)
  async getComments(
    @Param('id') postId: string,
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.communityService.getComments(
      postId,
      req.user!.id,
      cursor,
      limit,
    );
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

  // ── Followers / Following Lists ─────────────────────────────

  @Get('me/followers')
  @HttpCode(HttpStatus.OK)
  async getMyFollowers(
    @Req() req: Request,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.communityService.getMyFollowers(
      req.user!.id,
      limit ?? 20,
      cursor,
    );
  }

  @Get('me/following')
  @HttpCode(HttpStatus.OK)
  async getMyFollowing(
    @Req() req: Request,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.communityService.getMyFollowing(
      req.user!.id,
      limit ?? 20,
      cursor,
    );
  }

  // ── My Profile ───────────────────────────────────────────

  @Get('me/profile')
  @HttpCode(HttpStatus.OK)
  async getMyProfile(@Req() req: Request) {
    return this.communityService.getMyProfile(req.user!.id);
  }

  @Get('me/workouts')
  @HttpCode(HttpStatus.OK)
  async getMyWorkouts(
    @Req() req: Request,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.communityService.getWorkoutHistory(
      req.user!.id,
      limit ?? 10,
      cursor,
    );
  }

  // ── User Search & Suggested ──────────────────────────────

  @Get('users/search')
  @HttpCode(HttpStatus.OK)
  async searchUsers(
    @Query('q') query: string,
    @Query('limit') limit: number,
    @Req() req: Request,
  ) {
    return this.communityService.searchUsers(
      req.user!.id,
      query ?? '',
      limit ?? 10,
    );
  }

  @Get('users/suggested')
  @HttpCode(HttpStatus.OK)
  async getSuggestedUsers(@Query('limit') limit: number, @Req() req: Request) {
    return this.communityService.getSuggestedUsers(req.user!.id, limit ?? 10);
  }

  // ── User Profiles ─────────────────────────────────────────

  @Get('users/:userId/profile')
  @HttpCode(HttpStatus.OK)
  async getUserProfile(@Param('userId') userId: string, @Req() req: Request) {
    return this.communityService.getUserProfile(req.user!.id, userId);
  }

  @Get('users/:userId/workouts')
  @HttpCode(HttpStatus.OK)
  async getUserWorkouts(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.communityService.getWorkoutHistory(userId, limit ?? 10, cursor);
  }

  @Get('users/:userId/posts')
  @HttpCode(HttpStatus.OK)
  async getUserPosts(
    @Param('userId') userId: string,
    @Query('limit') limit: number | undefined,
    @Query('cursor') cursor: string | undefined,
    @Req() req: Request,
  ) {
    return this.communityService.getUserPosts(
      req.user!.id,
      userId,
      limit ?? 12,
      cursor,
    );
  }

  @Get('users/:userId/followers')
  @HttpCode(HttpStatus.OK)
  async getUserFollowers(
    @Param('userId') userId: string,
    @Query('limit') limit: number | undefined,
    @Query('cursor') cursor: string | undefined,
    @Req() req: Request,
  ) {
    return this.communityService.getUserFollowers(
      req.user!.id,
      userId,
      limit ?? 20,
      cursor,
    );
  }

  @Get('users/:userId/following')
  @HttpCode(HttpStatus.OK)
  async getUserFollowing(
    @Param('userId') userId: string,
    @Query('limit') limit: number | undefined,
    @Query('cursor') cursor: string | undefined,
    @Req() req: Request,
  ) {
    return this.communityService.getUserFollowing(
      req.user!.id,
      userId,
      limit ?? 20,
      cursor,
    );
  }

  @Get('users/:userId/compare')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  async compareWithUser(@Param('userId') userId: string, @Req() req: Request) {
    return this.communityAiService.compareUsers(req.user!.id, userId);
  }

  // ── Reports ──────────────────────────────────────────────

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  async reportContent(@Body() dto: CreateReportDto, @Req() req: Request) {
    return this.communityService.reportContent(req.user!.id, dto);
  }

  // ── Blocks ──────────────────────────────────────────────

  @Post('blocks')
  @HttpCode(HttpStatus.CREATED)
  async blockUser(@Body() dto: BlockUserDto, @Req() req: Request) {
    return this.communityService.blockUser(req.user!.id, dto.userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.OK)
  async unblockUser(@Param('userId') userId: string, @Req() req: Request) {
    return this.communityService.unblockUser(req.user!.id, userId);
  }

  @Get('blocks')
  @HttpCode(HttpStatus.OK)
  async getBlockedUsers(@Req() req: Request) {
    return this.communityService.getBlockedUsers(req.user!.id);
  }
}
