/**
 * Public URL prefix for exercise images served from our Supabase
 * Storage bucket `exercise-images`. Layout matches `<external_id>/{0,1}.jpg`
 * — same as the upstream free-exercise-db repo we used to hot-link, so
 * the only thing that changed when we cut over was this base URL.
 *
 * Derived from `SUPABASE_URL` so staging/prod/local all just work
 * without env-specific constants. Falls back to the legacy GitHub raw
 * URL only when SUPABASE_URL is missing (e.g. tests that don't load
 * the env), which keeps the resolver from emitting broken URLs at
 * boot. Production paths always go through Supabase.
 */
const LEGACY_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

function resolveBaseUrl(): string {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return LEGACY_BASE_URL;
  // Strip trailing slash so the joined path stays clean.
  const trimmed = supabaseUrl.replace(/\/+$/, '');
  return `${trimmed}/storage/v1/object/public/exercise-images`;
}

export const IMAGE_BASE_URL = resolveBaseUrl();

export function exerciseImageUrl(
  externalId: string | null | undefined,
): string | null {
  return externalId ? `${IMAGE_BASE_URL}/${externalId}/0.jpg` : null;
}
