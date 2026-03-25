import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

const EQUIPMENT_MAP: Record<string, string[]> = {
  full_gym: [],
  dumbbells_only: ['Dumbbells', 'Bodyweight'],
  bodyweight: ['Bodyweight'],
  home_gym: ['Dumbbells', 'Bodyweight', 'Bands'],
};

interface PlanDayGenerated {
  day_of_week: number;
  day_type: 'training' | 'rest';
  session_title?: string;
  session_type?: string;
  muscle_groups: string[];
  exercises: {
    library_exercise_id?: string;
    name: string;
    muscle_group: string;
    sets_display: string;
  }[];
}

@Injectable()
export class PlansAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI,
  ) {}

  async generateWeeklyPlan(
    onboarding: any,
    exerciseLibrary: any[],
    startDayOfWeek: number = 0,
  ): Promise<PlanDayGenerated[]> {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const totalDays = 7 - startDayOfWeek;
    const scaledFrequency = Math.round(
      (onboarding.training_frequency || 3) * (totalDays / 7),
    );

    const exerciseList = exerciseLibrary
      .map(
        (e) =>
          `- ${e.name} (id: ${e.id}, muscle: ${e.muscle_group}, equipment: ${e.equipment})`,
      )
      .join('\n');

    const prompt = `You are a fitness coach AI. Generate a ${totalDays}-day training plan from ${dayNames[startDayOfWeek]} through Sunday.

User profile:
- Goal: ${onboarding.primary_goal}
- Sport: ${onboarding.primary_sport}
- Experience: ${onboarding.experience_level}
- Training frequency: ${scaledFrequency} training days (scaled from ${onboarding.training_frequency}x/week for partial week)
- Workout duration: ${onboarding.workout_duration} min
- Equipment: ${onboarding.available_equipment}
- Injuries: ${JSON.stringify(onboarding.injuries)}

Available exercises (use these library_exercise_id values):
${exerciseList}

Respond with a JSON object:
{
  "days": [
    {
      "day_of_week": ${startDayOfWeek},
      "day_type": "training",
      "session_title": "Upper Body Power",
      "session_type": "strength",
      "muscle_groups": ["Chest", "Back", "Shoulders"],
      "exercises": [
        { "library_exercise_id": "uuid", "name": "Bench Press", "muscle_group": "Chest", "sets_display": "4 × 8" }
      ]
    }
  ]
}

Rules:
- day_of_week: 0=Monday, 1=Tuesday, ..., 6=Sunday
- Exactly ${scaledFrequency} training days, rest are "rest" type
- Rest days: day_type="rest", no exercises, empty muscle_groups
- Training days: 4-6 exercises each, varied muscle groups across the week
- Match rep scheme to goal (build_muscle: 3-4×8-10, lose_fat: 3×12-15, get_stronger: 4-5×5-6, improve_endurance: 3×15-20, stay_healthy: 3×10-12)
- Avoid exercises that aggravate listed injuries
- ONLY use library_exercise_id values from the available exercises list
- Distribute training days evenly through the partial week
- Return exactly ${totalDays} days (${startDayOfWeek} through 6)`;

    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: 'Generate the weekly training plan.' },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty OpenAI response');

      const parsed = JSON.parse(content) as { days: PlanDayGenerated[] };
      return parsed.days;
    } catch (error) {
      console.error('AI plan generation failed, using fallback:', error);
      return this.generateFallbackPlan(onboarding, exerciseLibrary, startDayOfWeek);
    }
  }

  private generateFallbackPlan(
    onboarding: any,
    exerciseLibrary: any[],
    startDayOfWeek: number = 0,
  ): PlanDayGenerated[] {
    const totalDays = 7 - startDayOfWeek;
    const scaledFrequency = Math.round(
      ((onboarding.training_frequency || 3) * totalDays) / 7,
    );
    const days: PlanDayGenerated[] = [];

    // Distribute training days evenly within the partial week
    const trainingDays = this.getTrainingDayIndices(scaledFrequency, startDayOfWeek);

    // Group exercises by muscle group
    const byMuscle = new Map<string, typeof exerciseLibrary>();
    for (const ex of exerciseLibrary) {
      const group = byMuscle.get(ex.muscle_group) ?? [];
      group.push(ex);
      byMuscle.set(ex.muscle_group, group);
    }
    const muscleGroups = [...byMuscle.keys()];

    const setsMap: Record<string, string> = {
      build_muscle: '3 × 10',
      lose_fat: '3 × 12',
      get_stronger: '4 × 6',
      improve_endurance: '3 × 15',
      stay_healthy: '3 × 10',
    };
    const setsDisplay = setsMap[onboarding.primary_goal] ?? '3 × 10';

    const sessionTemplates = [
      { title: 'Upper Body Power', type: 'strength', groups: ['Chest', 'Back', 'Shoulders'] },
      { title: 'Lower Body Strength', type: 'strength', groups: ['Legs', 'Glutes', 'Core'] },
      { title: 'Push Day', type: 'strength', groups: ['Chest', 'Shoulders', 'Triceps'] },
      { title: 'Pull Day', type: 'strength', groups: ['Back', 'Biceps', 'Core'] },
      { title: 'Full Body', type: 'strength', groups: ['Chest', 'Back', 'Legs'] },
      { title: 'Upper Hypertrophy', type: 'strength', groups: ['Chest', 'Back', 'Shoulders'] },
      { title: 'Lower Hypertrophy', type: 'strength', groups: ['Legs', 'Glutes', 'Core'] },
    ];

    let templateIdx = 0;
    for (let dow = startDayOfWeek; dow < 7; dow++) {
      if (trainingDays.includes(dow)) {
        const template = sessionTemplates[templateIdx % sessionTemplates.length];
        templateIdx++;

        // Pick exercises from relevant muscle groups
        const exercises: PlanDayGenerated['exercises'] = [];
        const targetCount = 5;
        let mgIdx = 0;

        while (exercises.length < targetCount && mgIdx < muscleGroups.length * 2) {
          const mg = muscleGroups[mgIdx % muscleGroups.length];
          const available = byMuscle.get(mg) ?? [];
          const unused = available.filter(
            (e) => !exercises.some((ex) => ex.library_exercise_id === e.id),
          );
          if (unused.length > 0) {
            const ex = unused[(dow + mgIdx) % unused.length];
            exercises.push({
              library_exercise_id: ex.id,
              name: ex.name,
              muscle_group: ex.muscle_group,
              sets_display: setsDisplay,
            });
          }
          mgIdx++;
        }

        const usedGroups = [...new Set(exercises.map((e) => e.muscle_group))];

        days.push({
          day_of_week: dow,
          day_type: 'training',
          session_title: template.title,
          session_type: template.type,
          muscle_groups: usedGroups,
          exercises,
        });
      } else {
        days.push({
          day_of_week: dow,
          day_type: 'rest',
          muscle_groups: [],
          exercises: [],
        });
      }
    }

    return days;
  }

  private getTrainingDayIndices(frequency: number, startDow: number = 0): number[] {
    const totalDays = 7 - startDow;
    const clamped = Math.min(Math.max(frequency, 0), totalDays);

    if (clamped === 0) return [];
    if (clamped === totalDays) {
      return Array.from({ length: totalDays }, (_, i) => startDow + i);
    }

    // Distribute training days evenly within the range [startDow, 6]
    const indices: number[] = [];
    for (let i = 0; i < clamped; i++) {
      indices.push(startDow + Math.round((i * (totalDays - 1)) / (clamped - 1 || 1)));
    }
    return [...new Set(indices)].sort((a, b) => a - b);
  }

  async generateCompletionNotes(
    planDay: any,
    session: any,
  ): Promise<string> {
    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4o';

    try {
      const exerciseSummary = session.exercises
        .map((e: any) => {
          const sets = e.exercise_sets ?? [];
          if (sets.length === 0) return `- ${e.name}: no sets logged`;
          const setDetails = sets
            .map((s: any) => {
              const weight = s.weight ? `${Number(s.weight)} ${s.weight_unit}` : 'BW';
              return `${weight} × ${s.reps}`;
            })
            .join(', ');
          return `- ${e.name}: ${setDetails}`;
        })
        .join('\n');

      const duration = session.duration_minutes
        ? `${session.duration_minutes} min`
        : 'unknown';

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a strength coach. Summarize this workout session in 1-2 brief sentences for the "Gains & Notes" section of a training plan. Be direct, reference specific lifts or improvements. No cheerleading.`,
          },
          {
            role: 'user',
            content: `Session: "${planDay.session_title}" (${duration})\n${exerciseSummary}`,
          },
        ],
        max_tokens: 100,
        temperature: 0.6,
      });

      return response.choices[0]?.message?.content ?? 'Session completed.';
    } catch {
      return 'Session completed successfully.';
    }
  }
}
