import { NextResponse } from "next/server";
import { sendDailySummaries } from "@/lib/daily-summary";
import { nairobiDate } from "@/lib/time";

/** Called by Vercel Cron every evening (see vercel.json). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendDailySummaries(nairobiDate());
  return NextResponse.json(result);
}
