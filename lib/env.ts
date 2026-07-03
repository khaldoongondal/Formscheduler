const supabaseAdminEnvKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
] as const;

const supabaseServiceEnvKeys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

export function getMissingEnv(keys: readonly string[]) {
  return keys.filter((key) => !process.env[key]);
}

export function getMissingSupabaseAdminEnv() {
  return getMissingEnv(supabaseAdminEnvKeys);
}

export function getMissingSupabaseServiceEnv() {
  return getMissingEnv(supabaseServiceEnvKeys);
}
