import { requireAdmin } from "@/lib/auth";

export async function middleware(request) {
  await requireAdmin();
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
