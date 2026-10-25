// The navigation of the app: five places for a member, and one Admin menu with grouped tools.
export type NavItem = { href: string; label: string };

export const MEMBER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/tasks", label: "Tasks" },
  { href: "/hours", label: "Hours" },
  { href: "/meetings", label: "Meetings" },
  { href: "/projects", label: "Projects" },
];

export const ADMIN_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "People",
    items: [
      { href: "/admin/members", label: "Members" },
      { href: "/admin/departments", label: "Departments" },
    ],
  },
  {
    title: "Work",
    items: [
      { href: "/admin/hours", label: "Hours" },
      { href: "/admin/meetings", label: "Meetings" },
      { href: "/admin/slack", label: "Slack" },
    ],
  },
  { title: "Insight", items: [{ href: "/admin/analytics", label: "Analytics" }] },
  { title: "Setup", items: [{ href: "/admin/settings", label: "Settings" }] },
];
