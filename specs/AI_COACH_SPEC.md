# AI Coach — Backend Spec (ChatGPT Integration)

The AI Coach is the core differentiator of GymBro: a personal fitness AI that has full context of the user's workout history, performance trends, injuries, and goals. The backend integrates with the **OpenAI ChatGPT API** (GPT-4o).

---

## Phased Rollout

### Phase 1 (NOW): Daily AI Motivation Message
- On dashboard load, generate a personalized daily message using ChatGPT
- Replaces the static `motivation_insights` table with a real AI-generated message
- Displayed in the existing `MotivationCard` on the home screen
- See **"Phase 1: Daily AI Message"** section below

### Phase 2 (LATER): Chat Interface
- Full chat via **WebSocket** (not REST/SSE)
- Conversation persistence, history, streaming replies
- See **"Phase 2: Chat (WebSocket)"** section below

---

## Phase 1: Daily AI Message

### Goal

When the user opens the home screen, the `MotivationCard` shows a personalized AI-generated message based on their real workout data. The message is generated once per day and cached — subsequent dashboard loads that day return the cached version.

### How It Works

```
iOS App                         NestJS API                      OpenAI
   │                                │                              │
   │  GET /api/v1/home/dashboard    │                              │
   │ ─────────────────────────────► │                              │
   │                                │  1. Check: cached message    │
   │                                │     for today exists?        │
   │                                │                              │
   │                                │  [YES] → return cached       │
   │                                │                              │
   │                                │  [NO]  → build context       │
   │                                │  2. Load user profile,       │
   │                                │     onboarding, sessions     │
   │                                │  3. Call OpenAI              │
   │                                │ ────────────────────────────►│
   │                                │ ◄────────────────────────────│
   │                                │  4. Save to motivation_      │
   │                                │     insights table           │
   │                                │  5. Return in dashboard      │
   │ ◄───────────────────────────── │                              │
```

### Implementation

#### 1. Update `HomeService.getDashboard()`

Modify the existing dashboard method. Instead of just fetching the latest `motivation_insights` row, check if one exists for today. If not, generate one via OpenAI.

```typescript
// src/home/home.service.ts — updated getDashboard()

async getDashboard(userId: string) {
  const [user, motivation, weekData, proposedSession] = await Promise.all([
    this.getUser(userId),
    this.getOrGenerateMotivation(userId),  // <-- CHANGED
    this.getWeekCompletedDays(userId),
    this.getProposedSession(userId),
  ]);

  return { user, motivation, week_completed_days: weekData, proposed_session: proposedSession };
}
```

#### 2. New method: `getOrGenerateMotivation()`

```typescript
private async getOrGenerateMotivation(userId: string) {
  // Check for existing valid motivation (generated today)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing = await this.prisma.motivationInsight.findFirst({
    where: {
      user_id: userId,
      created_at: { gte: todayStart },
    },
    orderBy: { created_at: 'desc' },
  });

  if (existing) {
    return {
      title: existing.title,
      message: existing.message,
      workouts_this_week: existing.workouts_this_week,
      personal_records: existing.personal_records,
    };
  }

  // Generate new motivation via AI
  return this.generateAIMotivation(userId);
}
```

#### 3. New method: `generateAIMotivation()`

```typescript
private async generateAIMotivation(userId: string) {
  const [onboarding, recentSessions, stats] = await Promise.all([
    this.prisma.onboardingData.findUnique({ where: { user_id: userId } }),
    this.getRecentSessions(userId, 14),
    this.getWeekStats(userId),
  ]);

  const prompt = this.buildMotivationPrompt(onboarding, recentSessions, stats);

  try {
    const completion = await this.openai.chat.completions.create({
      model: this.configService.get('OPENAI_MODEL', 'gpt-4o'),
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Generate today\'s motivation message.' },
      ],
      max_tokens: 200,
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');

    // Persist to DB (acts as cache for today)
    const insight = await this.prisma.motivationInsight.create({
      data: {
        user_id: userId,
        title: parsed.title ?? 'Keep pushing!',
        message: parsed.message ?? 'Every workout counts. Let\'s make today great.',
        workouts_this_week: stats.workoutsThisWeek,
        personal_records: parsed.personal_records ?? [],
        valid_until: this.endOfDay(),
      },
    });

    return {
      title: insight.title,
      message: insight.message,
      workouts_this_week: insight.workouts_this_week,
      personal_records: insight.personal_records,
    };
  } catch (error) {
    // Fallback: return a generic message if OpenAI fails
    return {
      title: 'Ready to train? 💪',
      message: `You've completed ${stats.workoutsThisWeek} workouts this week. Let's keep the momentum going!`,
      workouts_this_week: stats.workoutsThisWeek,
      personal_records: [],
    };
  }
}
```

#### 4. System prompt for motivation generation

```typescript
private buildMotivationPrompt(
  onboarding: OnboardingData | null,
  recentSessions: WorkoutSession[],
  stats: WeekStats,
): string {
  return `You are the GymBro AI Coach generating a daily motivation message for a fitness app home screen.

## User Profile
- Goal: ${onboarding?.primary_goal ?? 'general fitness'}
- Sport: ${onboarding?.primary_sport ?? 'general'}
- Experience: ${onboarding?.experience_level ?? 'beginner'}
- Training frequency target: ${onboarding?.training_frequency ?? 3}x/week
- Injuries: ${JSON.stringify(onboarding?.injuries ?? [])}

## This Week
- Workouts completed: ${stats.workoutsThisWeek}
- Target: ${onboarding?.training_frequency ?? 3}x/week
- Days remaining in week: ${stats.daysRemainingInWeek}

## Recent Sessions (last 14 days)
${this.formatRecentSessions(recentSessions)}

## Rules
- Return a JSON object with: { "title": "...", "message": "...", "personal_records": [...] }
- "title": Short motivational headline (3-6 words). Can include ONE emoji.
- "message": 1-2 sentences referencing the user's actual data. Use **bold** for key numbers. Be specific — mention exercise names, weights, or streaks when relevant.
- "personal_records": Array of exercise names where the user hit a new best recently. Empty array if none.
- Tone: Encouraging, concise, data-driven. Never generic.
- If the user has 0 workouts this week, motivate them to start. If they're on track, celebrate consistency. If they hit PRs, highlight those.
- Never fabricate data. Only reference exercises/numbers from the sessions provided above.`;
}
```

#### 5. Helper: Recent sessions formatter

```typescript
private formatRecentSessions(sessions: WorkoutSession[]): string {
  if (!sessions.length) return 'No sessions in the last 14 days.';

  return sessions.map(s => {
    const date = (s.completed_at ?? s.started_at)?.toISOString().split('T')[0];
    const exercises = s.exercises
      .map(e => `  - ${e.name}: ${e.sets_display}`)
      .join('\n');
    return `${date} — ${s.title} (${s.duration_minutes ?? '?'}min)\n${exercises}`;
  }).join('\n');
}
```

#### 6. Helper: Week stats

```typescript
private async getWeekStats(userId: string): Promise<WeekStats> {
  const weekStart = this.getWeekStart(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const completedCount = await this.prisma.workoutSession.count({
    where: {
      user_id: userId,
      status: 'completed',
      completed_at: { gte: weekStart, lt: weekEnd },
    },
  });

  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun
  const daysRemaining = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

  return {
    workoutsThisWeek: completedCount,
    daysRemainingInWeek: daysRemaining,
  };
}
```

### Dependencies

Add to `package.json`:

```bash
npm install openai
```

Add to `.env` / `.env.example`:

```env
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-4o"
```

### Inject OpenAI Client

Option A — initialize directly in `HomeService`:

```typescript
import OpenAI from 'openai';

@Injectable()
export class HomeService {
  private openai: OpenAI;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY'),
    });
  }
}
```

Option B — create a shared `OpenAIModule` (better if chat reuses it later):

```typescript
// src/openai/openai.module.ts
@Global()
@Module({
  providers: [
    {
      provide: 'OPENAI_CLIENT',
      useFactory: (config: ConfigService) => new OpenAI({ apiKey: config.get('OPENAI_API_KEY') }),
      inject: [ConfigService],
    },
  ],
  exports: ['OPENAI_CLIENT'],
})
export class OpenAIModule {}
```

Then inject with `@Inject('OPENAI_CLIENT') private openai: OpenAI`.

**Recommendation:** Use Option B since the chat feature will need it too.

### No iOS Changes Needed

The `MotivationCard` already renders `motivation.title` and `motivation.message` from the dashboard response. The AI-generated message has the same shape — it just has better, personalized content.

### Cost

- GPT-4o with `max_tokens: 200` and ~1000 token input ≈ $0.004/call
- 1 call per user per day (cached after first load)
- 1000 DAU = ~$4/day = ~$120/month

---

## Phase 2: Chat (WebSocket) — SPEC ONLY, NOT IMPLEMENTING NOW

### Transport: WebSocket via `@nestjs/websockets` + Socket.IO

```typescript
// src/chat/chat.gateway.ts

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*' },
})
export class ChatGateway implements OnGatewayConnection {

  @WebSocketServer()
  server: Server;

  // Authenticate on connection
  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    const user = await this.authService.validateToken(token);
    if (!user) {
      client.disconnect();
      return;
    }
    client.data.userId = user.id;
    client.join(`user:${user.id}`);
  }

  // Receive message from client
  @SubscribeMessage('send_message')
  async handleMessage(
    client: Socket,
    payload: { conversation_id?: string; message: string },
  ) {
    const userId = client.data.userId;

    // Emit acknowledgment
    client.emit('message_received', { status: 'processing' });

    // Stream AI response back
    const stream = this.chatService.streamMessage(userId, payload);

    client.emit('message_start', { conversation_id, message_id });

    for await (const chunk of stream) {
      client.emit('message_delta', { content: chunk });
    }

    client.emit('message_end', { message_id, token_count });
  }
}
```

### WebSocket Events

**Client → Server:**
| Event | Payload | Description |
|-------|---------|-------------|
| `send_message` | `{ conversation_id?: string, message: string }` | Send a chat message |
| `typing` | `{}` | User is typing (optional) |

**Server → Client:**
| Event | Payload | Description |
|-------|---------|-------------|
| `message_received` | `{ status: 'processing' }` | Acknowledgment |
| `message_start` | `{ conversation_id, message_id }` | AI response starting |
| `message_delta` | `{ content: string }` | Streamed token chunk |
| `message_end` | `{ message_id, token_count }` | AI response complete |
| `error` | `{ code, message }` | Error during generation |

### REST Endpoints (for history, not real-time)

- `GET /api/v1/chat/conversations` — list conversations
- `GET /api/v1/chat/conversations/:id/messages?limit=50&before=<id>` — paginated history
- `DELETE /api/v1/chat/conversations/:id` — delete conversation

### Database

Same `chat_conversations` + `chat_messages` tables as described in the original spec (see git history for full DDL).

### iOS Integration

- Use `SocketIO` Swift package
- Connect on chat screen open, disconnect on leave
- Display streamed `message_delta` events in real-time as the AI types

---

## Files Summary

### Phase 1 (implement now):

| File | Change |
|------|--------|
| `src/home/home.service.ts` | Add `getOrGenerateMotivation()`, `generateAIMotivation()`, `buildMotivationPrompt()`, OpenAI client init |
| `src/home/home.module.ts` | Import `ConfigModule` if not already |
| `src/openai/openai.module.ts` | **NEW** — Global OpenAI client provider |
| `src/openai/openai.service.ts` | **NEW** — Optional wrapper (or just use raw client) |
| `.env` / `.env.example` | Add `OPENAI_API_KEY`, `OPENAI_MODEL` |
| `package.json` | Add `openai` dependency |

### Phase 2 (later):

| File | Change |
|------|--------|
| `src/chat/chat.gateway.ts` | **NEW** — WebSocket gateway |
| `src/chat/chat.service.ts` | **NEW** — Message handling + OpenAI streaming |
| `src/chat/chat.controller.ts` | **NEW** — REST endpoints for history |
| `src/chat/chat.module.ts` | **NEW** — Module |
| `src/chat/dto/chat.dto.ts` | **NEW** — Validation |
| `prisma/schema.prisma` | Add `ChatConversation`, `ChatMessage` models |
| `supabase/migrations/` | Chat tables + RLS |
