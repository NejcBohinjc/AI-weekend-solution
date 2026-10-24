import { Placeholder } from "@/components/placeholder";
import { requireAdmin } from "@/lib/auth";

export default async function AdminTasksPage() {
  await requireAdmin();
  return <Placeholder title="Project board" description="All projects and tasks on one board, with assignment and history." />;
}
