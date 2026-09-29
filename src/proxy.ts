import { NextResponse, type NextRequest } from "next/server";
import { acceptsApiKey, hasApiKeyCredentials, hasSessionCookie, isPublicPath } from "@/lib/route-access";

/**
 * Optimistic auth gate: cookie presence only, no DB. Signed-out visitors to
 * app pages go to /login (APIs get a 401). Real session validation happens
 * in server layouts via requireUser()/requireOnboardedUser().
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname, process.env.NODE_ENV !== "production")) return NextResponse.next();
  if (hasSessionCookie(request.cookies)) return NextResponse.next();
  // Session-or-key APIs: let key-bearing requests reach the route, which authenticates them.
  if (acceptsApiKey(pathname) && hasApiKeyCredentials(request.headers, request.nextUrl.searchParams)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Skip Next internals and static files in /public (anything with an extension).
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
