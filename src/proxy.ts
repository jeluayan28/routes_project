import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readPublicEnv } from "@/lib/env";

/**
 * Keeps the Supabase session fresh for the admin area and sends signed-out
 * visitors to the login page. This is a convenience gate only: every admin page
 * and Server Action re-checks the administrator allow-list, and the database
 * enforces it with row-level security.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const env = readPublicEnv();
  if (!env.configured) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.env.NEXT_PUBLIC_SUPABASE_URL, env.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims() validates the token and refreshes it when it has expired.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && pathname !== "/admin/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname === "/admin/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
