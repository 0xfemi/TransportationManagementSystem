import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

const PUBLIC_PAGES = ["/login", "/register"];

/**
 * Sends signed-out visitors to the login page. This is a convenience for
 * navigation only: every API route authenticates and authorizes on its own.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const signedIn = token ? (await verifySession(token)) !== null : false;

  if (PUBLIC_PAGES.includes(pathname)) {
    return signedIn ? NextResponse.redirect(new URL("/command-center", req.url)) : NextResponse.next();
  }
  if (!signedIn) {
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  if (pathname === "/" || pathname === "/dashboard") {
    return NextResponse.redirect(new URL("/command-center", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
