import { NextResponse, type NextRequest } from "next/server";
import {
  getProposalBySlug,
  verifyPasscode,
  getSignatureForProposal,
  markFirstViewIfNeeded,
  recordProposalEvent,
  countViewEvents,
} from "@/lib/proposals";
import {
  buildNotFoundPage,
  buildExpiredPage,
  buildPasscodeGate,
  buildSigningWidget,
  buildExecutedWidget,
  injectBeforeBodyClose,
} from "@/lib/widget";
import { unlockCookieName } from "@/lib/unlock-cookie";
import { isRateLimited } from "@/lib/rate-limit";

// This route serves a foreign HTML document verbatim (plus an injected widget) rather than JSX
// rendered inside the app's own layout — see BUILD_SPEC.md §5 for why it's a route handler and
// not a page.
export const dynamic = "force-dynamic";

function htmlResponse(html: string, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new NextResponse(html, { ...init, headers });
}

function clientIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/p/[slug]">
) {
  const { slug } = await context.params;
  const proposal = await getProposalBySlug(slug);
  if (!proposal) return htmlResponse(buildNotFoundPage(), { status: 404 });

  if (proposal.passcode_hash) {
    const unlocked =
      request.cookies.get(unlockCookieName(proposal.id))?.value === "1";
    if (!unlocked) return htmlResponse(buildPasscodeGate({}));
  }

  const isExpired =
    proposal.expires_at &&
    new Date(proposal.expires_at) < new Date() &&
    !proposal.signed_at;
  if (isExpired) return htmlResponse(buildExpiredPage(proposal.owner_email));

  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");
  await markFirstViewIfNeeded(proposal);
  await recordProposalEvent({
    proposalId: proposal.id,
    eventType: "viewed",
    actor: "client",
    ip,
    userAgent,
  });

  let widget: string;
  if (proposal.signed_at) {
    const signature = await getSignatureForProposal(proposal.id);
    const viewCount = await countViewEvents(proposal.id);
    widget = signature
      ? buildExecutedWidget(proposal, signature, { viewCount })
      : "";
  } else {
    widget = buildSigningWidget(proposal, slug);
  }

  const finalHtml = injectBeforeBodyClose(proposal.content_html, widget);
  return htmlResponse(finalHtml);
}

/** Handles the passcode gate's form submission. */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/p/[slug]">
) {
  const { slug } = await context.params;
  const proposal = await getProposalBySlug(slug);
  if (!proposal) return htmlResponse(buildNotFoundPage(), { status: 404 });

  const formData = await request.formData();
  const passcode = String(formData.get("passcode") ?? "");
  const ip = clientIp(request) ?? "unknown";

  if (isRateLimited(`passcode:${slug}:${ip}`, 5, 60 * 60 * 1000)) {
    return htmlResponse(
      buildPasscodeGate({
        errorMessage: "Too many attempts. Try again in an hour.",
      }),
      { status: 429 }
    );
  }

  const ok = await verifyPasscode(proposal, passcode);
  if (!ok) {
    return htmlResponse(
      buildPasscodeGate({ errorMessage: "That passcode isn't right. Try again." })
    );
  }

  const response = NextResponse.redirect(new URL(`/p/${slug}`, request.url), {
    status: 303,
  });
  response.cookies.set(unlockCookieName(proposal.id), "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: `/p/${slug}`,
  });
  return response;
}
