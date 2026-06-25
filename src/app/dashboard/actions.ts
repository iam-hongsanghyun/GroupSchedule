"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function deleteEvent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (id) {
    // RLS restricts deletes to the owner; cascades remove participants + blocks.
    await supabase.from("events").delete().eq("id", id);
  }
  revalidatePath("/dashboard");
}
