import { createServiceClient } from "@/lib/supabase/server";

/** Direct auth user lookup by email (RPC from migration 0022), replacing the old paged user scan. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_auth_user_id_by_email", {
    p_email: email.trim().toLowerCase()
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data ? data : null;
}

export async function isAuthUserConfirmed(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("is_auth_user_confirmed", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}
