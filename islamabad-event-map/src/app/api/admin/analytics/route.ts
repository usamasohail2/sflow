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
    return NextResponse.json(
      {
        stats: null,
        error: "Could not load visitor analytics from Supabase",
      },
      { status: 500 }
    );
  }
}
