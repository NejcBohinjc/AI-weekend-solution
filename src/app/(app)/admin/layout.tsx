import { requireAdmin } from "@/lib/auth";

/**
 * Admin pages are for admins only. The middleware no longer checks the admin flag (that needed a database
 * query on every request), so this layout and each page's own requireAdmin() do. The session lookup is
 * cached per request, so this costs nothing extra.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return children;
}
