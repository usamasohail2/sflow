import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { listProfiles } from "@/lib/profiles";
import { hasSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSupabase()) {
    return NextResponse.json({
      profiles: [],
      error: "Supabase is not configured",
    });
  }

  try {
    const profiles = await listProfiles();
    return NextResponse.json({ profiles });
  } catch (error) {
    console.error("Admin list profiles failed:", error);
    return NextResponse.json(
      { error: "Could not load profiles from Supabase" },
      { status: 500 }
    );
  }
}
