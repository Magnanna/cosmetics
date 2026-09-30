import { NextResponse } from "next/server";
import { sendCreditReminders } from "@/lib/credit-reminders";
import { nairobiDate } from "@/lib/time";

/** Called by Vercel Cron every morning (see vercel.json). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await sendCreditReminders(nairobiDate()));
}
