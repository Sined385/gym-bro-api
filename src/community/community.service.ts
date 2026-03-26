import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { CreatePostDto, CreateCommentDto, FeedQueryDto } from './dto/community.dto';
import { ACCENT_COLORS } from '../home/session-exercise.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Feed ──────────────────────────────────────────────────

  async getFeed(userId: string, query: FeedQueryDto) {
    const tab = query.tab ?? 'global';
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? new Date(query.cursor) : undefined;

    const followingIds = await this.getFollowingIds(userId);
    const followingSet = new Set(followingIds);

    let whereClause: any;

    if (tab === 'following') {
      whereClause = {
        user_id: { in: [...followingIds, userId] },
        ...(cursor ? { created_at: { lt: cursor } } : {}),
      };
    } else {
      whereClause = {
        visibility: 'global',
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
      },
    });

    // Notify followers (fire-and-forget)
    this.notifyFollowersOfNewPost(userId, post.id);

    return this.enrichPost(post, userId);
  }

  async deletePost(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new AppException('POST_NOT_FOUND', 'Post not found', HttpStatus.NOT_FOUND);
    }
    if (post.user_id !== userId) {
      throw new AppException('FORBIDDEN', 'Cannot delete another user\'s post', HttpStatus.FORBIDDEN);
    }

    await this.prisma.post.delete({ where: { id: postId } });
    return { success: true };
  }

  // ── Likes ─────────────────────────────────────────────────

  async toggleLike(userId: string, postId: string) {
    const existing = await this.prisma.postLike.findUnique({
      where: { post_id_user_id: { post_id: postId, user_id: userId } },
    });

    if (existing) {
      await this.prisma.postLike.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.postLike.create({
        data: { post_id: postId, user_id: userId },
      });

      // Notify post author of new like (fire-and-forget)
      const post = await this.prisma.post.findUnique({ where: { id: postId } });
      if (post && post.user_id !== userId) {
        const liker = await this.prisma.user.findUnique({ where: { id: userId } });
        this.notificationsService.sendToUser(post.user_id, {
          type: 'like',
          title: 'New Like',
          body: `${liker?.full_name ?? 'Someone'} liked your post`,
          data: { postId },
        });
      }
    }

    const likeCount = await this.prisma.postLike.count({
      where: { post_id: postId },
    });

    return { isLiked: !existing, likeCount };
  }

  // ── Comments ──────────────────────────────────────────────

  async getComments(postId: string, cursor?: string, limit?: number) {
    const take = limit ?? 20;
    const cursorDate = cursor ? new Date(cursor) : undefined;

    const comments = await this.prisma.postComment.findMany({
      where: {
        post_id: postId,
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
      throw new AppException('POST_NOT_FOUND', 'Post not found', HttpStatus.NOT_FOUND);
    }

    const comment = await this.prisma.postComment.create({
      data: {
        post_id: postId,
        user_id: userId,
        content: dto.content,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // Notify post author about new comment
    if (post.user_id !== userId) {
      this.notificationsService.sendToUser(post.user_id, {
        type: 'comment',
        title: 'New Comment',
        body: `${user?.full_name ?? 'Someone'} commented on your post`,
        data: { postId },
      });
    }

    return {
      id: comment.id,
      user: {
        id: userId,
        fullName: user?.full_name ?? 'Unknown',
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
      throw new AppException('COMMENT_NOT_FOUND', 'Comment not found', HttpStatus.NOT_FOUND);
    }
    if (comment.user_id !== userId) {
      throw new AppException('FORBIDDEN', 'Cannot delete another user\'s comment', HttpStatus.FORBIDDEN);
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

    // Notify user of new follower (fire-and-forget)
    const follower = await this.prisma.user.findUnique({ where: { id: followerId } });
    this.notificationsService.sendToUser(followingId, {
      type: 'follow',
      title: 'New Follower',
      body: `${follower?.full_name ?? 'Someone'} started following you`,
      data: { userId: followerId },
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
      throw new AppException('USER_NOT_FOUND', 'User not found', HttpStatus.NOT_FOUND);
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
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const completedWhere = { user_id: targetUserId, status: 'completed' as const };

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

    const recentPosts = await this.prisma.post.findMany({
      where: postWhere,
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    const profileFollowingSet = new Set(isFollowing ? [targetUserId] : []);
    const enrichedPosts = await Promise.all(
      recentPosts.map((p) => this.enrichPost(p, currentUserId, profileFollowingSet)),
    );

    return {
      user: {
        id: user.id,
        fullName: user.full_name ?? 'Unknown',
        avatarUrl: user.avatar_url,
      },
      primaryGoal: onboarding?.primary_goal ?? null,
      experienceLevel: onboarding?.experience_level ?? null,
      bodyWeightKg: onboarding?.body_weight_kg ?? null,
      consistencyStats: {
        totalSessions,
        last30DaysSessions: recentSessions,
        thisWeek,
        thisMonth,
        thisYear,
      },
      isFollowing,
      followsMe,
      recentPosts: enrichedPosts,
      isOwnProfile,
    };
  }

  // ── My Profile ───────────────────────────────────────────

  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new AppException('USER_NOT_FOUND', 'User not found', HttpStatus.NOT_FOUND);
    }

    const onboarding = await this.prisma.onboardingData.findUnique({
      where: { user_id: userId },
    });

    // Follower/following counts + consistency + session aggregates in parallel
    const completedWhere = { user_id: userId, status: 'completed' as const };
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [
      followerCount,
      followingCount,
      thisWeek,
      thisMonth,
      thisYear,
      sessionAgg,
      avgDurationAgg,
      recentPosts,
    ] = await Promise.all([
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
    ]);

    // These queries can fail without breaking the profile — use safe defaults
    let avgEffortLevel: number | null = null;
    try {
      const feedbackAgg = await this.prisma.sessionFeedback.aggregate({
        where: {
          session: { user_id: userId, status: 'completed' },
        },
        _avg: { effort_level: true },
      });
      avgEffortLevel = feedbackAgg._avg.effort_level ?? null;
    } catch { /* no feedback data */ }

    let totalWeightLifted = 0;
    try {
      const weightResult = await this.prisma.$queryRaw<[{ total: number | null }]>`
        SELECT COALESCE(SUM(es.weight * es.reps), 0) as total
        FROM exercise_sets es
        JOIN session_exercises se ON se.id = es.exercise_id
        JOIN workout_sessions ws ON ws.id = se.session_id
        WHERE ws.user_id = ${userId} AND ws.status = 'completed'
      `;
      totalWeightLifted = Number(weightResult[0]?.total ?? 0);
    } catch { /* no weight data */ }

    let personalRecords: { exerciseName: string; weight: number; weightUnit: string; reps: number; date: string | null }[] = [];
    try {
      const prRows = await this.prisma.$queryRaw<
        { exercise_name: string; weight: number; weight_unit: string; reps: number; date: string | null }[]
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
      personalRecords = prRows.map((pr) => ({
        exerciseName: pr.exercise_name,
        weight: Number(pr.weight),
        weightUnit: pr.weight_unit,
        reps: pr.reps,
        date: pr.date,
      }));
    } catch { /* no PR data */ }

    // Enrich posts
    const followingIds = await this.getFollowingIds(userId);
    const followingSet = new Set(followingIds);
    const enrichedPosts = await Promise.all(
      recentPosts.map((p) => this.enrichPost(p, userId, followingSet)),
    );

    const totalSessions = sessionAgg._count;

    return {
      user: {
        id: user.id,
        fullName: user.full_name ?? 'Unknown',
        avatarUrl: user.avatar_url,
      },
      primaryGoal: onboarding?.primary_goal ?? null,
      experienceLevel: onboarding?.experience_level ?? null,
      bodyWeightKg: onboarding?.body_weight_kg ?? null,
      memberSince: user.created_at.toISOString(),
      consistencyStats: {
        totalSessions,
        last30DaysSessions: 0,
        thisWeek,
        thisMonth,
        thisYear,
      },
      extendedStats: {
        totalDurationMinutes: sessionAgg._sum.duration_minutes ?? 0,
        totalCalories: sessionAgg._sum.calories ?? 0,
        avgSessionDuration: Math.round(avgDurationAgg._avg.duration_minutes ?? 0),
        avgEffortLevel,
        totalWeightLifted,
        personalRecords,
      },
      followerCount,
      followingCount,
      recentPosts: enrichedPosts,
    };
  }

  // ── Private Helpers ───────────────────────────────────────

  private async notifyFollowersOfNewPost(authorId: string, postId: string) {
    try {
      const author = await this.prisma.user.findUnique({ where: { id: authorId } });
      const followers = await this.prisma.follow.findMany({ where: { following_id: authorId } });
      for (const f of followers) {
        this.notificationsService.sendToUser(f.follower_id, {
          type: 'new_post',
          title: 'New Post',
          body: `${author?.full_name ?? 'Someone'} shared a new post`,
          data: { postId },
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

  private async enrichPost(post: any, currentUserId: string, followingSet?: Set<string>) {
    const user = await this.prisma.user.findUnique({
      where: { id: post.user_id },
    });

    const likeCount = await this.prisma.postLike.count({
      where: { post_id: post.id },
    });

    const commentCount = await this.prisma.postComment.count({
      where: { post_id: post.id },
    });

    const isLiked = !!(await this.prisma.postLike.findUnique({
      where: {
        post_id_user_id: { post_id: post.id, user_id: currentUserId },
      },
    }));

    let workoutAttachment: any = null;
    if (post.workout_session_id) {
      const session = await this.prisma.workoutSession.findUnique({
        where: { id: post.workout_session_id },
        include: {
          exercises: { orderBy: { step_number: 'asc' }, include: { exercise_sets: true } },
          feedback: true,
        },
      });
      if (session) {
        const sessionWithRelations = session as any;
        workoutAttachment = {
          sessionId: sessionWithRelations.id,
          title: sessionWithRelations.title,
          durationMinutes: sessionWithRelations.duration_minutes,
          exerciseCount: sessionWithRelations.exercises.length,
          aiGenerated: sessionWithRelations.ai_generated,
          rpe: sessionWithRelations.feedback?.effort_level ?? null,
          exercises: sessionWithRelations.exercises.map((ex: any, index: number) => ({
            name: ex.name,
            muscleGroup: ex.muscle_group,
            stepNumber: ex.step_number,
            setsDisplay: ex.sets_display,
            accentColor: ACCENT_COLORS[index % ACCENT_COLORS.length],
            totalSets: ex.exercise_sets.length,
            totalReps: ex.exercise_sets.reduce((sum: number, s: any) => sum + s.reps, 0),
          })),
        };
      }
    }

    const isFollowingAuthor =
      post.user_id === currentUserId
        ? false
        : followingSet
          ? followingSet.has(post.user_id)
          : false;

    return {
      id: post.id,
      user: {
        id: post.user_id,
        fullName: user?.full_name ?? 'Unknown',
        avatarUrl: user?.avatar_url,
      },
      content: post.content,
      visibility: post.visibility,
      photoUrl: post.photo_url,
      workoutAttachment,
      likeCount,
      commentCount,
      isLiked,
      isFollowingAuthor,
      isOwnPost: post.user_id === currentUserId,
      createdAt: post.created_at.toISOString(),
    };
  }
}
