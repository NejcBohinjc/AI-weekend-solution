import { Placeholder } from "@/components/placeholder";
import { requireAdmin } from "@/lib/auth";

export default async function AdminPage() {
  await requireAdmin();
  return <Placeholder title="Admin overview" description="A quick view of who needs attention this week." />;
}
