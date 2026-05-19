import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  CreatePostDto,
  CreateCommentDto,
  CreateReportDto,
  FeedQueryDto,
} from './dto/community.dto';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { exerciseImageUrl } from '../common/exercise-image';
import { getWeekStart } from '../common/date-utils';

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ── Feed ──────────────────────────────────────────────────

  async getFeed(userId: string, query: FeedQueryDto) {
    const tab = query.tab ?? 'global';
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? new Date(query.cursor) : undefined;

    const [followingIds, blockedIds] = await Promise.all([
      this.getFollowingIds(userId),
      this.getBlockedIds(userId),
    ]);
    const followingSet = new Set(followingIds);

    let whereClause: any;

    if (tab === 'following') {
      whereClause = {
        user_id: { in: [...followingIds, userId], notIn: blockedIds },
        ...(cursor ? { created_at: { lt: cursor } } : {}),
      };
    } else {
      whereClause = {
        visibility: 'global',
        ...(blockedIds.length > 0 ? { user_id: { notIn: blockedIds } } : {}),
        ...(cursor ? { created_at: { lt: cursor } } : {}),
      };
    }

    const posts = await this.prisma.post.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = posts.length > limit;
    const resultPosts = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore
      ? resultPosts[resultPosts.length - 1].created_at.toISOString()
      : null;

    const enriched = await Promise.all(
      resultPosts.map((post) => this.enrichPost(post, userId, followingSet)),
    );

    return {
      posts: enriched,
      nextCursor,
      hasMore,
    };
  }

  // ── Posts ─────────────────────────────────────────────────

  async createPost(userId: string, dto: CreatePostDto) {
    // Verify workout_session_id exists before inserting (avoid FK violation)
    let sessionId = dto.workout_session_id ?? null;
    if (sessionId) {
      const session = await this.prisma.workoutSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) {
        sessionId = null;
      }
    }

    const post = await this.prisma.post.create({
      data: {
        user_id: userId,
        content: dto.content,
        visibility: dto.visibility ?? 'global',
        workout_session_id: sessionId,
        photo_url: dto.photo_url ?? null,
        share_config: dto.share_config ?? undefined,
        card_image_url: dto.card_image_url ?? null,
      },
    });

    this.analytics.track(userId, 'post_created', {
      post_id: post.id,
      visibility: post.visibility,
      has_workout: !!post.workout_session_id,
      has_photo: !!post.photo_url,
    });

    // Notify followers (fire-and-forget)
    this.notifyFollowersOfNewPost(userId, post.id);

    return this.enrichPost(post, userId);
  }

  async getPostById(currentUserId: string, postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new AppException(
        'POST_NOT_FOUND',
        'Post not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const followingIds = await this.getFollowingIds(currentUserId);
    return this.enrichPost(post, currentUserId, new Set(followingIds));
  }

  async getPostPublic(postId: string) {
    // Only globally-visible posts are accessible via the unauthenticated
    // /p/:postId web fallback. friends-only / private posts must never leak
    // to anonymous link scrapers.
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.visibility !== 'global') return null;
    const user = await this.prisma.user.findUnique({
      where: { id: post.user_id },
    });
    return { post, user };
  }

  async deletePost(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new AppException(
        'POST_NOT_FOUND',
        'Post not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (post.user_id !== userId) {
      throw new AppException(
        'FORBIDDEN',
        "Cannot delete another user's post",
        HttpStatus.FORBIDDEN,
      );
    }

    await this.prisma.post.delete({ where: { id: postId } });
    return { success: true };
  }

  // ── Reactions ────────────────────────────────────────────

  private static readonly EMOJI_DISPLAY: Record<string, string> = {
    fire: '\uD83D\uDD25',
    muscle: '\uD83D\uDCAA',
    heart: '\u2764\uFE0F',
    clap: '\uD83D\uDC4F',
    wow: '\uD83D\uDE2E',
    trophy: '\uD83C\uDFC6',
  };

  async toggleReaction(userId: string, postId: string, emoji: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (post) {
      const blockedIds = await this.getBlockedIds(userId);
      if (blockedIds.includes(post.user_id)) {
        throw new AppException(
          'BLOCKED',
          'You cannot interact with this user',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const existing = await this.prisma.postLike.findFirst({
      where: { post_id: postId, user_id: userId, emoji },
    });

    if (existing) {
      await this.prisma.postLike.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.postLike.create({
        data: { post_id: postId, user_id: userId, emoji },
      });

      this.analytics.track(userId, 'post_reacted', {
        post_id: postId,
        emoji,
      });

      if (post && post.user_id !== userId) {
        const reactor = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        const reactorName = reactor?.full_name ?? 'Someone';
        const emojiChar = CommunityService.EMOJI_DISPLAY[emoji] ?? emoji;
        this.notificationsService.sendToUser(post.user_id, {
          type: 'like',
          title: `${reactorName} reacted ${emojiChar} to your post`,
          body: `${reactorName} reacted ${emojiChar} to your post`,
          data: { post_id: postId, user_id: userId },
        });
      }
    }

    return this.getPostReactions(postId, userId);
  }

  private async getPostReactions(postId: string, userId: string) {
    const [grouped, userReactions] = await Promise.all([
      this.prisma.postLike.groupBy({
        by: ['emoji'],
        where: { post_id: postId },
        _count: true,
      }),
      this.prisma.postLike.findMany({
        where: { post_id: postId, user_id: userId },
        select: { emoji: true },
      }),
    ]);

    const userEmojiSet = new Set(userReactions.map((r) => r.emoji));
    const reactions = grouped.map((g) => ({
      emoji: g.emoji,
      count: g._count,
      isReacted: userEmojiSet.has(g.emoji),
    }));

    const totalReactionCount = reactions.reduce((s, r) => s + r.count, 0);

    return { reactions, totalReactionCount };
  }

  // ── Comments ──────────────────────────────────────────────

  async getComments(
    postId: string,
    userId?: string,
    cursor?: string,
    limit?: number,
  ) {
    const take = limit ?? 20;
    const cursorDate = cursor ? new Date(cursor) : undefined;
    const blockedIds = userId ? await this.getBlockedIds(userId) : [];

    const comments = await this.prisma.postComment.findMany({
      where: {
        post_id: postId,
        ...(blockedIds.length > 0 ? { user_id: { notIn: blockedIds } } : {}),
        ...(cursorDate ? { created_at: { lt: cursorDate } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: take + 1,
    });

    const hasMore = comments.length > take;
    const resultComments = hasMore ? comments.slice(0, take) : comments;
    const nextCursor = hasMore
      ? resultComments[resultComments.length - 1].created_at.toISOString()
      : null;

    const userIds = [...new Set(resultComments.map((c) => c.user_id))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      comments: resultComments.map((c) => {
        const user = userMap.get(c.user_id);
        return {
          id: c.id,
          user: {
            id: c.user_id,
            fullName: user?.full_name ?? 'Unknown',
            username: user?.username ?? null,
            avatarUrl: user?.avatar_url,
          },
          content: c.content,
          createdAt: c.created_at.toISOString(),
        };
      }),
      nextCursor,
      hasMore,
    };
  }

  async createComment(userId: string, postId: string, dto: CreateCommentDto) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new AppException(
        'POST_NOT_FOUND',
        'Post not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Block check
    const blockedIds = await this.getBlockedIds(userId);
    if (blockedIds.includes(post.user_id)) {
      throw new AppException(
        'BLOCKED',
        'You cannot interact with this user',
        HttpStatus.FORBIDDEN,
      );
    }

    const comment = await this.prisma.postComment.create({
      data: {
        post_id: postId,
        user_id: userId,
        content: dto.content,
      },
    });

    this.analytics.track(userId, 'post_commented', {
      post_id: postId,
      comment_id: comment.id,
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // Notify post author about new comment
    if (post.user_id !== userId) {
      const commenterName = user?.full_name ?? 'Someone';
      this.notificationsService.sendToUser(post.user_id, {
        type: 'comment',
        title: `${commenterName} commented on your post`,
        body:
          dto.content.length > 150
            ? dto.content.slice(0, 150) + '...'
            : dto.content,
        data: { post_id: postId, user_id: userId },
      });
    }

    return {
      id: comment.id,
      user: {
        id: userId,
        fullName: user?.full_name ?? 'Unknown',
        username: user?.username ?? null,
        avatarUrl: user?.avatar_url,
      },
      content: comment.content,
      createdAt: comment.created_at.toISOString(),
    };
  }

  async deleteComment(userId: string, commentId: string) {
    const comment = await this.prisma.postComment.findUnique({
      where: { id: commentId },
    });
    if (!comment) {
      throw new AppException(
        'COMMENT_NOT_FOUND',
        'Comment not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (comment.user_id !== userId) {
      throw new AppException(
        'FORBIDDEN',
        "Cannot delete another user's comment",
        HttpStatus.FORBIDDEN,
      );
    }

    await this.prisma.postComment.delete({ where: { id: commentId } });
    return { success: true };
  }

  // ── Follow ──────────────────────────────────────────────

  async followUser(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new AppException(
        'INVALID_REQUEST',
        'Cannot follow yourself',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Block check
    const blockedIds = await this.getBlockedIds(followerId);
    if (blockedIds.includes(followingId)) {
      throw new AppException(
        'BLOCKED',
        'You cannot interact with this user',
        HttpStatus.FORBIDDEN,
      );
    }

    const existing = await this.prisma.follow.findUnique({
      where: {
        follower_id_following_id: {
          follower_id: followerId,
          following_id: followingId,
        },
      },
    });

    if (existing) {
      return { followId: existing.id, message: 'Already following' };
    }

    const follow = await this.prisma.follow.create({
      data: {
        follower_id: followerId,
        following_id: followingId,
      },
    });

    this.analytics.track(followerId, 'follow_created', {
      following_id: followingId,
    });

    // Notify user of new follower (fire-and-forget)
    const follower = await this.prisma.user.findUnique({
      where: { id: followerId },
    });
    const followerName = follower?.full_name ?? 'Someone';
    this.notificationsService.sendToUser(followingId, {
      type: 'follow',
      title: `${followerName} started following you`,
      body: `${followerName} started following you`,
      data: { user_id: followerId },
    });

    return { followId: follow.id, message: 'Followed successfully' };
  }

  async unfollowUser(followerId: string, followingId: string) {
    const existing = await this.prisma.follow.findUnique({
      where: {
        follower_id_following_id: {
          follower_id: followerId,
          following_id: followingId,
        },
      },
    });

    if (!existing) {
      return { success: true, message: 'Not following' };
    }

    await this.prisma.follow.delete({ where: { id: existing.id } });
    return { success: true, message: 'Unfollowed successfully' };
  }

  // ── User Profile ──────────────────────────────────────────

  async getUserProfile(currentUserId: string, targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!user) {
      throw new AppException(
        'USER_NOT_FOUND',
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Block check
    if (currentUserId !== targetUserId) {
      const blockedIds = await this.getBlockedIds(currentUserId);
      if (blockedIds.includes(targetUserId)) {
        throw new AppException(
          'BLOCKED',
          'This profile is not available',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: targetUserId },
    });

    // Follow status
    const [iFollowRecord, followsMeRecord] = await Promise.all([
      this.prisma.follow.findUnique({
        where: {
          follower_id_following_id: {
            follower_id: currentUserId,
            following_id: targetUserId,
          },
        },
      }),
      this.prisma.follow.findUnique({
        where: {
          follower_id_following_id: {
            follower_id: targetUserId,
            following_id: currentUserId,
          },
        },
      }),
    ]);

    const isFollowing = !!iFollowRecord;
    const followsMe = !!followsMeRecord;

    // Consistency stats
    const totalSessions = await this.prisma.workoutSession.count({
      where: { user_id: targetUserId, status: 'completed' },
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSessions = await this.prisma.workoutSession.count({
      where: {
        user_id: targetUserId,
        status: 'completed',
        completed_at: { gte: thirtyDaysAgo },
      },
    });

    // Week/month/year session counts
    const { startOfWeek, startOfMonth, startOfYear } =
      this.getTimePeriodStarts();

    const completedWhere = {
      user_id: targetUserId,
      status: 'completed' as const,
    };

    const [thisWeek, thisMonth, thisYear] = await Promise.all([
      this.prisma.workoutSession.count({
        where: { ...completedWhere, completed_at: { gte: startOfWeek } },
      }),
      this.prisma.workoutSession.count({
        where: { ...completedWhere, completed_at: { gte: startOfMonth } },
      }),
      this.prisma.workoutSession.count({
        where: { ...completedWhere, completed_at: { gte: startOfYear } },
      }),
    ]);

    // Recent posts
    const isOwnProfile = currentUserId === targetUserId;

    const postWhere: any = { user_id: targetUserId };
    if (!isOwnProfile && !isFollowing) {
      postWhere.visibility = 'global';
    }

    const [
      followerCount,
      followingCount,
      sessionAgg,
      avgDurationAgg,
      avgEffortLevel,
      totalWeightLifted,
      personalRecords,
      recentPosts,
    ] = await Promise.all([
      this.prisma.follow.count({ where: { following_id: targetUserId } }),
      this.prisma.follow.count({ where: { follower_id: targetUserId } }),
      this.prisma.workoutSession.aggregate({
        where: completedWhere,
        _sum: { duration_minutes: true, calories: true },
        _count: true,
      }),
      this.prisma.workoutSession.aggregate({
        where: completedWhere,
        _avg: { duration_minutes: true },
      }),
      this.getAvgEffortLevel(targetUserId),
      this.getTotalWeightLifted(targetUserId),
      this.getPersonalRecords(targetUserId),
      this.prisma.post.findMany({
        where: postWhere,
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    ]);

    const profileFollowingSet = new Set(isFollowing ? [targetUserId] : []);
    const enrichedPosts = await Promise.all(
      recentPosts.map((p) =>
        this.enrichPost(p, currentUserId, profileFollowingSet),
      ),
    );

    return {
      user: {
        id: user.id,
        fullName: user.full_name ?? 'Unknown',
        username: user.username ?? null,
        avatarUrl: user.avatar_url,
      },
      primaryGoal: onboarding?.primary_goals?.[0] ?? null,
      experienceLevel: onboarding?.experience_level ?? null,
      bodyWeightKg: onboarding?.body_weight_kg ?? null,
      memberSince: user.created_at.toISOString(),
      consistencyStats: {
        totalSessions,
        last30DaysSessions: recentSessions,
        thisWeek,
        thisMonth,
        thisYear,
      },
      extendedStats: {
        totalDurationMinutes: sessionAgg._sum.duration_minutes ?? 0,
        totalCalories: sessionAgg._sum.calories ?? 0,
        avgSessionDuration: Math.round(
          avgDurationAgg._avg.duration_minutes ?? 0,
        ),
        avgEffortLevel,
        totalWeightLifted,
        personalRecords,
      },
      followerCount,
      followingCount,
      isFollowing,
      followsMe,
      recentPosts: enrichedPosts,
      isOwnProfile,
    };
  }

  // ── My Profile ───────────────────────────────────────────

  async getMyProfile(userId: string) {
    // Fetch user first — must exist before proceeding
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new AppException(
        'USER_NOT_FOUND',
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Follower/following counts + consistency + session aggregates + user/onboarding in parallel
    const completedWhere = { user_id: userId, status: 'completed' as const };
    const { startOfWeek, startOfMonth, startOfYear } =
      this.getTimePeriodStarts();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      onboarding,
      followerCount,
      followingCount,
      thisWeek,
      thisMonth,
      thisYear,
      recentSessions,
      sessionAgg,
      avgDurationAgg,
      recentPosts,
      avgEffortLevel,
      totalWeightLifted,
      personalRecords,
      followingIds,
    ] = await Promise.all([
      this.prisma.onboardingData.findUnique({ where: { user_id: userId } }),
      this.prisma.follow.count({ where: { following_id: userId } }),
      this.prisma.follow.count({ where: { follower_id: userId } }),
      this.prisma.workoutSession.count({
        where: { ...completedWhere, completed_at: { gte: startOfWeek } },
      }),
      this.prisma.workoutSession.count({
        where: { ...completedWhere, completed_at: { gte: startOfMonth } },
      }),
      this.prisma.workoutSession.count({
        where: { ...completedWhere, completed_at: { gte: startOfYear } },
      }),
      this.prisma.workoutSession.count({
        where: {
          user_id: userId,
          status: 'completed',
          completed_at: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.workoutSession.aggregate({
        where: completedWhere,
        _sum: { duration_minutes: true, calories: true },
        _count: true,
      }),
      this.prisma.workoutSession.aggregate({
        where: completedWhere,
        _avg: { duration_minutes: true },
      }),
      this.prisma.post.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
      this.getAvgEffortLevel(userId),
      this.getTotalWeightLifted(userId),
      this.getPersonalRecords(userId),
      this.getFollowingIds(userId),
    ]);

    const enrichedPosts = await this.enrichPostsBatch(recentPosts, userId);

    const followingSet = new Set(followingIds);
    // Apply followingSet to enriched posts (set isFollowingAuthor)
    const enrichedPostsWithFollowing = enrichedPosts.map((post) => ({
      ...post,
      isFollowingAuthor:
        post.user.id === userId ? false : followingSet.has(post.user.id),
    }));

    const totalSessions = sessionAgg._count;

    return {
      user: {
        id: user.id,
        fullName: user.full_name ?? 'Unknown',
        username: user.username ?? null,
        avatarUrl: user.avatar_url,
      },
      primaryGoal: onboarding?.primary_goals?.[0] ?? null,
      experienceLevel: onboarding?.experience_level ?? null,
      bodyWeightKg: onboarding?.body_weight_kg ?? null,
      memberSince: user.created_at.toISOString(),
      consistencyStats: {
        totalSessions,
        last30DaysSessions: recentSessions,
        thisWeek,
        thisMonth,
        thisYear,
      },
      extendedStats: {
        totalDurationMinutes: sessionAgg._sum.duration_minutes ?? 0,
        totalCalories: sessionAgg._sum.calories ?? 0,
        avgSessionDuration: Math.round(
          avgDurationAgg._avg.duration_minutes ?? 0,
        ),
        avgEffortLevel,
        totalWeightLifted,
        personalRecords,
      },
      followerCount,
      followingCount,
      recentPosts: enrichedPostsWithFollowing,
    };
  }

  // ── Workout History ──────────────────────────────────────

  async getWorkoutHistory(userId: string, limit = 10, cursor?: string) {
    const cursorDate = cursor ? new Date(cursor) : undefined;

    const sessions = await this.prisma.workoutSession.findMany({
      where: {
        user_id: userId,
        status: 'completed',
        ...(cursorDate ? { completed_at: { lt: cursorDate } } : {}),
      },
      orderBy: { completed_at: 'desc' },
      take: limit + 1,
      include: {
        exercises: {
          orderBy: { step_number: 'asc' },
          include: { exercise_sets: { orderBy: { set_number: 'asc' } } },
        },
      },
    });

    const hasMore = sessions.length > limit;
    const resultSessions = hasMore ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasMore
      ? (resultSessions[
          resultSessions.length - 1
        ].completed_at?.toISOString() ?? null)
      : null;

    return {
      workouts: resultSessions.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        duration_minutes: s.duration_minutes,
        calories: s.calories,
        completed_at:
          s.completed_at?.toISOString() ?? s.created_at.toISOString(),
        exercises: s.exercises.map((e, index) => ({
          id: e.id,
          name: e.name,
          muscle_group: e.muscle_group,
          accent_color: ACCENT_COLORS[index % ACCENT_COLORS.length],
          step_number: e.step_number,
          image_url: exerciseImageUrl(e.external_id),
          external_id: e.external_id ?? null,
          sets: e.exercise_sets.map((set) => ({
            set_number: set.set_number,
            weight: set.weight ? Number(set.weight) : null,
            weight_unit: set.weight_unit,
            reps: set.reps,
          })),
        })),
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    };
  }

  // ── Followers / Following Lists ─────────────────────────────

  async getMyFollowers(userId: string, limit = 20, cursor?: string) {
    const cursorDate = cursor ? new Date(cursor) : undefined;
    const blockedIds = await this.getBlockedIds(userId);

    const follows = await this.prisma.follow.findMany({
      where: {
        following_id: userId,
        ...(blockedIds.length > 0
          ? { follower_id: { notIn: blockedIds } }
          : {}),
        ...(cursorDate ? { created_at: { lt: cursorDate } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = follows.length > limit;
    const resultFollows = hasMore ? follows.slice(0, limit) : follows;
    const nextCursor = hasMore
      ? resultFollows[resultFollows.length - 1].created_at.toISOString()
      : null;

    const followerIds = resultFollows.map((f) => f.follower_id);
    const [users, followingIds] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: followerIds } } }),
      this.getFollowingIds(userId),
    ]);
    const followingSet = new Set(followingIds);
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      users: resultFollows.map((f) => {
        const user = userMap.get(f.follower_id);
        return {
          id: f.follower_id,
          fullName: user?.full_name ?? 'Unknown',
          username: user?.username ?? null,
          avatarUrl: user?.avatar_url ?? null,
          isFollowing: followingSet.has(f.follower_id),
        };
      }),
      nextCursor,
      hasMore,
    };
  }

  async getMyFollowing(userId: string, limit = 20, cursor?: string) {
    const cursorDate = cursor ? new Date(cursor) : undefined;
    const blockedIds = await this.getBlockedIds(userId);

    const follows = await this.prisma.follow.findMany({
      where: {
        follower_id: userId,
        ...(blockedIds.length > 0
          ? { following_id: { notIn: blockedIds } }
          : {}),
        ...(cursorDate ? { created_at: { lt: cursorDate } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = follows.length > limit;
    const resultFollows = hasMore ? follows.slice(0, limit) : follows;
    const nextCursor = hasMore
      ? resultFollows[resultFollows.length - 1].created_at.toISOString()
      : null;

    const followingIds = resultFollows.map((f) => f.following_id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: followingIds } },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      users: resultFollows.map((f) => {
        const user = userMap.get(f.following_id);
        return {
          id: f.following_id,
          fullName: user?.full_name ?? 'Unknown',
          username: user?.username ?? null,
          avatarUrl: user?.avatar_url ?? null,
          isFollowing: true,
        };
      }),
      nextCursor,
      hasMore,
    };
  }

  // ── User Search ──────────────────────────────────────────

  async searchUsers(currentUserId: string, query: string, limit: number) {
    if (!query || query.trim().length === 0) {
      return { users: [] };
    }

    const blockedIds = await this.getBlockedIds(currentUserId);
    const followingIds = await this.getFollowingIds(currentUserId);
    const followingSet = new Set(followingIds);

    const excludeIds = [currentUserId, ...blockedIds];

    const users = await this.prisma.user.findMany({
      where: {
        id: { notIn: excludeIds },
        OR: [
          { full_name: { contains: query, mode: 'insensitive' } },
          { username: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { created_at: 'desc' },
    });

    return {
      users: users.map((u) => ({
        id: u.id,
        fullName: u.full_name ?? 'Unknown',
        username: u.username ?? null,
        avatarUrl: u.avatar_url ?? null,
        isFollowing: followingSet.has(u.id),
      })),
    };
  }

  // ── Suggested Users ────────────────────────────────────────

  async getSuggestedUsers(currentUserId: string, limit: number) {
    const [followingIds, blockedIds] = await Promise.all([
      this.getFollowingIds(currentUserId),
      this.getBlockedIds(currentUserId),
    ]);

    const excludeIds = [currentUserId, ...followingIds, ...blockedIds];

    const users = await this.prisma.$queryRaw<
      {
        id: string;
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
        session_count: number;
      }[]
    >`
      SELECT u.id, u.full_name, u.username, u.avatar_url,
             COUNT(ws.id)::int as session_count
      FROM "User" u
      LEFT JOIN workout_sessions ws ON ws.user_id = u.id AND ws.status = 'completed'
      WHERE u.id != ALL(${excludeIds})
      GROUP BY u.id
      ORDER BY session_count DESC
      LIMIT ${limit}
    `;

    return {
      users: users.map((u) => ({
        id: u.id,
        fullName: u.full_name ?? 'Unknown',
        username: u.username ?? null,
        avatarUrl: u.avatar_url ?? null,
        sessionCount: Number(u.session_count),
      })),
    };
  }

  // ── Private Helpers ───────────────────────────────────────

  private async notifyFollowersOfNewPost(authorId: string, postId: string) {
    try {
      const author = await this.prisma.user.findUnique({
        where: { id: authorId },
      });
      const followers = await this.prisma.follow.findMany({
        where: { following_id: authorId },
      });
      const authorName = author?.full_name ?? 'Someone';
      for (const f of followers) {
        this.notificationsService.sendToUser(f.follower_id, {
          type: 'new_post',
          title: `${authorName} shared a new post`,
          body: `${authorName} shared a new post`,
          data: { post_id: postId, user_id: authorId },
        });
      }
    } catch {
      // Fire-and-forget
    }
  }

  private async getFollowingIds(userId: string): Promise<string[]> {
    const follows = await this.prisma.follow.findMany({
      where: { follower_id: userId },
    });

    return follows.map((f) => f.following_id);
  }

  // ── Reports & Blocks ──────────────────────────────────────

  async reportContent(reporterId: string, dto: CreateReportDto) {
    // Validate content exists
    if (dto.contentType === 'post') {
      const post = await this.prisma.post.findUnique({
        where: { id: dto.contentId },
      });
      if (!post)
        throw new AppException(
          'POST_NOT_FOUND',
          'Post not found',
          HttpStatus.NOT_FOUND,
        );
      if (post.user_id === reporterId)
        throw new AppException(
          'INVALID_REQUEST',
          'Cannot report your own content',
          HttpStatus.BAD_REQUEST,
        );
    } else if (dto.contentType === 'comment') {
      const comment = await this.prisma.postComment.findUnique({
        where: { id: dto.contentId },
      });
      if (!comment)
        throw new AppException(
          'COMMENT_NOT_FOUND',
          'Comment not found',
          HttpStatus.NOT_FOUND,
        );
      if (comment.user_id === reporterId)
        throw new AppException(
          'INVALID_REQUEST',
          'Cannot report your own content',
          HttpStatus.BAD_REQUEST,
        );
    } else if (dto.contentType === 'user') {
      if (dto.contentId === reporterId)
        throw new AppException(
          'INVALID_REQUEST',
          'Cannot report yourself',
          HttpStatus.BAD_REQUEST,
        );
      const user = await this.prisma.user.findUnique({
        where: { id: dto.contentId },
      });
      if (!user)
        throw new AppException(
          'USER_NOT_FOUND',
          'User not found',
          HttpStatus.NOT_FOUND,
        );
    }

    await this.prisma.contentReport.upsert({
      where: {
        reporter_id_content_type_content_id: {
          reporter_id: reporterId,
          content_type: dto.contentType,
          content_id: dto.contentId,
        },
      },
      update: { reason: dto.reason, description: dto.description ?? null },
      create: {
        reporter_id: reporterId,
        content_type: dto.contentType,
        content_id: dto.contentId,
        reason: dto.reason,
        description: dto.description ?? null,
      },
    });

    this.analytics.track(reporterId, 'content_reported', {
      content_type: dto.contentType,
      content_id: dto.contentId,
      reason: dto.reason,
    });

    return { success: true };
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new AppException(
        'INVALID_REQUEST',
        'Cannot block yourself',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: blockedId },
    });
    if (!user) {
      throw new AppException(
        'USER_NOT_FOUND',
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.userBlock.upsert({
      where: {
        blocker_id_blocked_id: {
          blocker_id: blockerId,
          blocked_id: blockedId,
        },
      },
      update: {},
      create: { blocker_id: blockerId, blocked_id: blockedId },
    });

    // Auto-unfollow in both directions
    await this.prisma.follow.deleteMany({
      where: {
        OR: [
          { follower_id: blockerId, following_id: blockedId },
          { follower_id: blockedId, following_id: blockerId },
        ],
      },
    });

    this.analytics.track(blockerId, 'user_blocked', { blocked_id: blockedId });

    return { success: true };
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.prisma.userBlock.deleteMany({
      where: { blocker_id: blockerId, blocked_id: blockedId },
    });
    return { success: true };
  }

  async getBlockedUsers(userId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: { blocker_id: userId },
      orderBy: { created_at: 'desc' },
    });

    const blockedUserIds = blocks.map((b) => b.blocked_id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: blockedUserIds } },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      users: blocks.map((b) => {
        const user = userMap.get(b.blocked_id);
        return {
          id: b.blocked_id,
          fullName: user?.full_name ?? 'Unknown',
          username: user?.username ?? null,
          avatarUrl: user?.avatar_url ?? null,
          blockedAt: b.created_at.toISOString(),
        };
      }),
    };
  }

  private async getBlockedIds(userId: string): Promise<string[]> {
    const blocks = await this.prisma.userBlock.findMany({
      where: {
        OR: [{ blocker_id: userId }, { blocked_id: userId }],
      },
    });

    const ids = new Set<string>();
    for (const b of blocks) {
      if (b.blocker_id === userId) ids.add(b.blocked_id);
      else ids.add(b.blocker_id);
    }
    return [...ids];
  }

  private async enrichPostsBatch(posts: any[], currentUserId: string) {
    if (posts.length === 0) return [];

    const postIds = posts.map((p) => p.id);
    const postUserIds = [...new Set(posts.map((p) => p.user_id))];
    const sessionIds = posts
      .filter((p) => p.workout_session_id)
      .map((p) => p.workout_session_id!);

    const [users, reactionGroups, commentCounts, userReactions, sessions] =
      await Promise.all([
        // Batch fetch all post authors
        this.prisma.user.findMany({ where: { id: { in: postUserIds } } }),
        // Batch count reactions per post+emoji
        this.prisma.postLike.groupBy({
          by: ['post_id', 'emoji'],
          where: { post_id: { in: postIds } },
          _count: true,
        }),
        // Batch count comments per post
        this.prisma.postComment.groupBy({
          by: ['post_id'],
          where: { post_id: { in: postIds } },
          _count: true,
        }),
        // Batch check current user's reactions
        this.prisma.postLike.findMany({
          where: { post_id: { in: postIds }, user_id: currentUserId },
          select: { post_id: true, emoji: true },
        }),
        // Batch fetch workout sessions for posts that have them
        sessionIds.length > 0
          ? this.prisma.workoutSession.findMany({
              where: { id: { in: sessionIds } },
              include: {
                exercises: {
                  orderBy: { step_number: 'asc' },
                  include: {
                    exercise_sets: { orderBy: { set_number: 'asc' } },
                  },
                },
                feedback: true,
              },
            })
          : Promise.resolve([]),
      ]);

    // Build O(1) lookup maps
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Reactions per post: Map<postId, {emoji, count}[]>
    const reactionMap = new Map<string, { emoji: string; count: number }[]>();
    const reactionCountMap = new Map<string, number>();
    for (const rg of reactionGroups) {
      const list = reactionMap.get(rg.post_id) ?? [];
      list.push({ emoji: rg.emoji, count: rg._count });
      reactionMap.set(rg.post_id, list);
      reactionCountMap.set(
        rg.post_id,
        (reactionCountMap.get(rg.post_id) ?? 0) + rg._count,
      );
    }

    // User reactions: Map<postId, Set<emoji>>
    const userReactionMap = new Map<string, Set<string>>();
    for (const ur of userReactions) {
      const set = userReactionMap.get(ur.post_id) ?? new Set();
      set.add(ur.emoji);
      userReactionMap.set(ur.post_id, set);
    }

    const commentCountMap = new Map(
      commentCounts.map((cc) => [cc.post_id, cc._count]),
    );
    const sessionMap = new Map((sessions as any[]).map((s) => [s.id, s]));

    return posts.map((post) => {
      const postUser = userMap.get(post.user_id);
      const commentCount = commentCountMap.get(post.id) ?? 0;

      // Reactions
      const postReactions = reactionMap.get(post.id) ?? [];
      const userEmojis = userReactionMap.get(post.id) ?? new Set();
      const reactions = postReactions.map((r) => ({
        emoji: r.emoji,
        count: r.count,
        isReacted: userEmojis.has(r.emoji),
      }));
      const reactionCount = reactionCountMap.get(post.id) ?? 0;

      // Legacy compat
      const likeCount = reactionCount;
      const isLiked = userEmojis.has('heart');

      let workoutAttachment: any = null;
      if (post.workout_session_id) {
        const session = sessionMap.get(post.workout_session_id);
        if (session) {
          workoutAttachment = {
            sessionId: session.id,
            title: session.title,
            durationMinutes: session.duration_minutes,
            exerciseCount: session.exercises.length,
            aiGenerated: session.ai_generated,
            rpe: session.feedback?.effort_level ?? null,
            exercises: session.exercises.map((ex: any, index: number) => {
              const totalSets = ex.exercise_sets.length;
              const totalReps = ex.exercise_sets.reduce(
                (sum: number, s: any) => sum + s.reps,
                0,
              );
              const repsPerSet =
                totalSets > 0 ? Math.round(totalReps / totalSets) : 0;
              const setsDisplay =
                ex.sets_display ||
                (totalSets > 0 ? `${totalSets} × ${repsPerSet}` : null);
              return {
                name: ex.name,
                muscleGroup: ex.muscle_group,
                stepNumber: ex.step_number,
                setsDisplay,
                accentColor: ACCENT_COLORS[index % ACCENT_COLORS.length],
                totalSets,
                totalReps,
                libraryExerciseId: ex.library_exercise_id ?? null,
                imageUrl: exerciseImageUrl(ex.external_id),
                externalId: ex.external_id ?? null,
                sets: ex.exercise_sets
                  .sort((a: any, b: any) => a.set_number - b.set_number)
                  .map((s: any) => ({
                    setNumber: s.set_number,
                    weight: s.weight ? Number(s.weight) : null,
                    weightUnit: s.weight_unit ?? 'kg',
                    reps: s.reps,
                  })),
                supersetGroupId: ex.superset_group_id ?? null,
                supersetOrder: ex.superset_order ?? null,
              };
            }),
          };
        }
      }

      return {
        id: post.id,
        user: {
          id: post.user_id,
          fullName: postUser?.full_name ?? 'Unknown',
          username: postUser?.username ?? null,
          avatarUrl: postUser?.avatar_url,
        },
        content: post.content,
        visibility: post.visibility,
        photoUrl: post.photo_url,
        shareConfig: post.share_config ?? null,
        cardImageUrl: post.card_image_url ?? null,
        workoutAttachment,
        likeCount,
        commentCount,
        isLiked,
        reactions,
        reactionCount,
        isFollowingAuthor: false, // Caller sets this with followingSet
        isOwnPost: post.user_id === currentUserId,
        createdAt: post.created_at.toISOString(),
      };
    });
  }

  private async enrichPost(
    post: any,
    currentUserId: string,
    followingSet?: Set<string>,
  ) {
    const [enriched] = await this.enrichPostsBatch([post], currentUserId);
    return {
      ...enriched,
      isFollowingAuthor:
        post.user_id === currentUserId
          ? false
          : followingSet
            ? followingSet.has(post.user_id)
            : false,
    };
  }

  // ── Profile Stats Helpers ───────────────────────────────

  private async getAvgEffortLevel(userId: string): Promise<number | null> {
    try {
      const feedbackAgg = await this.prisma.sessionFeedback.aggregate({
        where: {
          session: { user_id: userId, status: 'completed' },
        },
        _avg: { effort_level: true },
      });
      return feedbackAgg._avg.effort_level ?? null;
    } catch {
      return null;
    }
  }

  private async getTotalWeightLifted(userId: string): Promise<number> {
    try {
      const weightResult = await this.prisma.$queryRaw<
        [{ total: number | null }]
      >`
        SELECT COALESCE(SUM(es.weight * es.reps), 0) as total
        FROM exercise_sets es
        JOIN session_exercises se ON se.id = es.exercise_id
        JOIN workout_sessions ws ON ws.id = se.session_id
        WHERE ws.user_id = ${userId} AND ws.status = 'completed'
      `;
      return Number(weightResult[0]?.total ?? 0);
    } catch {
      return 0;
    }
  }

  private async getPersonalRecords(userId: string): Promise<
    {
      exerciseName: string;
      weight: number;
      weightUnit: string;
      reps: number;
      date: string | null;
    }[]
  > {
    try {
      const prRows = await this.prisma.$queryRaw<
        {
          exercise_name: string;
          weight: number;
          weight_unit: string;
          reps: number;
          date: string | null;
        }[]
      >`
        SELECT DISTINCT ON (se.name)
          se.name as exercise_name,
          es.weight::float as weight,
          es.weight_unit,
          es.reps,
          ws.completed_at::text as date
        FROM exercise_sets es
        JOIN session_exercises se ON se.id = es.exercise_id
        JOIN workout_sessions ws ON ws.id = se.session_id
        WHERE ws.user_id = ${userId}
          AND ws.status = 'completed'
          AND es.weight IS NOT NULL
          AND es.weight > 0
        ORDER BY se.name, es.weight DESC, es.created_at DESC
        LIMIT 5
      `;
      return prRows.map((pr) => ({
        exerciseName: pr.exercise_name,
        weight: Number(pr.weight),
        weightUnit: pr.weight_unit,
        reps: pr.reps,
        date: pr.date,
      }));
    } catch {
      return [];
    }
  }

  private getTimePeriodStarts(): {
    startOfWeek: Date;
    startOfMonth: Date;
    startOfYear: Date;
  } {
    const now = new Date();
    const startOfWeek = getWeekStart(now);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return { startOfWeek, startOfMonth, startOfYear };
  }
}
