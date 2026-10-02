import { NextResponse } from "next/server";
import { publicApi } from "@/lib/http";
import { clearedSessionCookie } from "@/lib/auth/session";

export const POST = publicApi(async () => {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearedSessionCookie());
  return response;
});
