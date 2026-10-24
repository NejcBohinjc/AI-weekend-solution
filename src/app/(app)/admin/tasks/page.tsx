import { redirect } from "next/navigation";

// The project board is /projects (for everyone; admins add and edit projects there).
export default function AdminTasksPage() {
  redirect("/projects");
}
