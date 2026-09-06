import { NextResponse } from "next/server";
import { getTripoBalance, isTripoConfigured } from "@/lib/tripo";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  if (!isTripoConfigured()) {
    return NextResponse.json({ provider: "tripo", configured: false, ok: false }, { status: 503 });
  }

  try {
    const balance = await getTripoBalance();
    return NextResponse.json({
      provider: "tripo",
      configured: true,
      ok: true,
      balance: balance.balance,
      frozen: balance.frozen,
    });
  } catch (error) {
    return NextResponse.json({
      provider: "tripo",
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : "Falha ao validar credencial Tripo.",
    }, { status: 502 });
  }
}
