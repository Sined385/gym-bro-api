/**
 * Builds the "personal context" snippet that gets appended to every
 * OpenAI system prompt — coach chat, plan generation, motivation
 * insights, AI quick workouts. Returns an empty string when the user
 * hasn't filled in the field so prompts stay unchanged for users who
 * never opted in.
 *
 * Kept as a one-liner shared helper so that adding it to a new prompt
 * site is a one-import + one-append, and so a refactor to the wording
 * (e.g. "Coach memory" vs "Personal context") only touches one place.
 */
export function aiContextLine(
  onboarding: { ai_coach_context?: string | null } | null | undefined,
): string {
  const context = onboarding?.ai_coach_context?.trim();
  if (!context) return '';
  return `\n\nPersonal context from the user (always respect this):\n${context}\n`;
}
