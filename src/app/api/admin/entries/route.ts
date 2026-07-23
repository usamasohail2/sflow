import { NextRequest, NextResponse } from "next/server";
import { fetchAllEntries } from "@/lib/airtable";
import { isAdminAuthorized } from "@/lib/adminAuth";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const entries = await fetchAllEntries();
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Admin fetch entries failed:", error);
    return NextResponse.json(
      { error: "Could not load entries from Airtable" },
      { status: 500 }
    );
  }
}
