export function formatRecentSessions(sessions: any[]): string {
  if (sessions.length === 0) return 'No recent sessions in the last 14 days.';

  const blocks = sessions.map((s) => {
    const date = s.completed_at
      ? new Date(s.completed_at).toISOString().split('T')[0]
      : 'unknown';
    const duration = s.duration_minutes
      ? `${s.duration_minutes} min`
      : 'unknown duration';
    const exerciseLines = s.exercises.map((e: any) => {
      const sets = e.exercise_sets;
      if (!sets || sets.length === 0)
        return `  - ${e.name} (${e.muscle_group}): no sets logged`;
      const setDetails = sets
        .map((set: any) => {
          const weight = set.weight
            ? `${Number(set.weight)} ${set.weight_unit}`
            : 'BW';
          return `${weight} × ${set.reps}`;
        })
        .join(', ');
      return `  - ${e.name} (${e.muscle_group}): ${setDetails}`;
    });
    return `${date} — "${s.title}" (${duration})\n${exerciseLines.join('\n')}`;
  });

  return `Session log (last 14 days):\n${blocks.join('\n\n')}`;
}
