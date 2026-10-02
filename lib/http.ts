import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError, badRequest, forbidden, unauthorized } from "@/lib/errors";
import { authenticate, type AuthContext } from "@/lib/auth/context";
import { can, type Permission } from "@/lib/rbac";

type RouteParams = Record<string, string>;
type RouteContext = { params: RouteParams };

export type ApiContext = {
  req: NextRequest;
  auth: AuthContext;
  params: RouteParams;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_failed",
          message: "Request validation failed",
          details: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      },
      { status: 422 },
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return NextResponse.json(
      { error: { code: "conflict", message: "A record with these values already exists" } },
      { status: 409 },
    );
  }
  console.error(
    JSON.stringify({
      level: "error",
      msg: "unhandled_api_error",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500 },
  );
}

/**
 * Cookie sessions are sent by the browser automatically, so a state-changing
 * request must prove it came from this site. API-key requests are exempt:
 * a browser never attaches those on its own.
 */
function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw forbidden("Missing Origin header");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Invalid Origin header");
  }
  if (originHost !== host) throw forbidden("Cross-site request blocked");
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  return NextResponse.json(result ?? { ok: true });
}

/** Wraps an authenticated route: resolves the caller, checks the permission. */
export function api(
  permission: Permission | null,
  fn: (ctx: ApiContext) => Promise<unknown>,
) {
  return async (req: NextRequest, context: RouteContext): Promise<Response> => {
    try {
      const auth = await authenticate(req);
      if (!auth) throw unauthorized();
      if (auth.via === "session" && !SAFE_METHODS.has(req.method)) {
        assertSameOrigin(req);
      }
      if (permission && !can(auth.role, permission)) throw forbidden();
      return toResponse(await fn({ req, auth, params: context?.params ?? {} }));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Wraps a route that needs no authentication (login, health checks). */
export function publicApi(fn: (req: NextRequest) => Promise<unknown>) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      return toResponse(await fn(req));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<T extends z.ZodType>(
  req: NextRequest,
  schema: T,
): z.infer<T> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
});

export function page<T>(data: T[], total: number, limit: number, offset: number) {
  return { data, total, limit, offset };
}
