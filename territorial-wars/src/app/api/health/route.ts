import { NextResponse } from "next/server";
import { getSystemHealth } from "@/lib/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const report = await getSystemHealth();
  return NextResponse.json(report, {
    status: report.level === "down" ? 503 : 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
