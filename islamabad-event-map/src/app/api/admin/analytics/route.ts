import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { hasSupabase } from "@/lib/supabase";
import { getVisitorStats } from "@/lib/visitors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSupabase()) {
    return NextResponse.json({
      stats: null,
      error: "Supabase is not configured",
    });
  }

  try {
    const stats = await getVisitorStats();
    return NextResponse.json({ stats });
  } catch (error) {
    console.error("Admin analytics failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not load analytics";
    return NextResponse.json(
      {
        stats: null,
        error: message.includes("Could not find the table")
          ? "Run supabase/visitors.sql in the Supabase SQL Editor, then refresh."
          : "Could not load visitor analytics from Supabase",
      },
      { status: 500 }
    );
  }
}
