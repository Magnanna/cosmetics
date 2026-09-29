import { NextResponse } from "next/server";
import { getReceiptByToken } from "@/lib/receipt";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await getReceiptByToken(token);
  if (!r) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  return NextResponse.json(r, { headers: { "Cache-Control": "private, no-store" } });
}
