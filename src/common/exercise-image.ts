export const IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

export function exerciseImageUrl(
  externalId: string | null | undefined,
): string | null {
  return externalId ? `${IMAGE_BASE_URL}/${externalId}/0.jpg` : null;
}
