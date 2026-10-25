// The institute's running projects (01-07 from "Naši projekti", the document for new members; the
// planned projects are left out) with placeholder tasks to show how projects, people and departments
// work together. Used by `npm run db:seed` and on its own by `npm run seed:projects`.
//
// Idempotent: projects are matched by name, and a project that already has tasks gets no placeholder
// tasks, so running it again never duplicates anything. People are matched by email and departments by
// name; a person or department that does not exist leaves the task unassigned.
// The placeholder tasks are ordinary app tasks, so the tasks sync writes them to the Google Sheet of
// the database it runs on: create them in one database per sheet.
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "../src/db";
import { departments, members, projects, taskEvents, tasks } from "../src/db/schema";
import { DEFAULT_PRIORITY, STATUS_LABELS, type TaskPriority, type TaskStatus } from "../src/lib/tasks/constants";

type Owner = { email: string } | { department: "Core" | "Voice" | "Tech" } | null;
type PlaceholderTask = { title: string; owner: Owner; status: TaskStatus; due: string | null; type: string; priority?: TaskPriority };
type TeamProject = { name: string; description: string; tasks: PlaceholderTask[] };

const person = (name: string): Owner => ({ email: `${name}@sandbox.example` });
const dept = (department: "Core" | "Voice" | "Tech"): Owner => ({ department });

export const TEAM_PROJECTS: TeamProject[] = [
  {
    name: "Delavnice na srednjih šolah",
    description: "Delavnice za dijake pri aktivnem državljanstvu (divergentno mišljenje, debata Shape Talk, učenje z AI) in predstavitev inštituta.",
    tasks: [
      { title: "Dogovori novembrske termine z gimnazijami", owner: person("neza.oblak"), status: "in_progress", due: "2026-10-30", type: "Events", priority: "urgent" },
      { title: "Prilagodi delavnico o učenju z AI za 1. letnike", owner: dept("Tech"), status: "todo", due: "2026-11-06", type: "Content" },
      { title: "Pripravi predstavitev inštituta za dijake", owner: dept("Voice"), status: "verification", due: "2026-10-27", type: "Marketing" },
      { title: "Izvedi delavnico divergentnega mišljenja", owner: person("aljaz.hribar"), status: "todo", due: "2026-11-12", type: "Events" },
      { title: "Zberi povratne informacije profesorjev", owner: null, status: "todo", due: null, type: "Other", priority: "low" },
    ],
  },
  {
    name: "Shape Talk",
    description: "Moderirane debate za mlade o družbeno pomembnih temah, z aplikacijo za glasovanje, skupnostjo na Discordu in povzetki na Substacku.",
    tasks: [
      { title: "Izberi temo in napiši trditve za novembrsko debato", owner: person("ziga.krajnc"), status: "in_progress", due: "2026-10-28", type: "Content", priority: "urgent" },
      { title: "Dodaj glasovanje v živo v aplikacijo", owner: dept("Tech"), status: "todo", due: "2026-11-10", type: "Other" },
      { title: "Objavi tedensko vprašanje na Discordu", owner: dept("Voice"), status: "todo", due: "2026-10-26", type: "Marketing", priority: "urgent" },
      { title: "Napiši povzetek zadnje debate za Substack", owner: person("matic.kos"), status: "done", due: "2026-10-20", type: "Content" },
      { title: "Rezerviraj dvorano za večerni dogodek", owner: person("ana.kovac"), status: "verification", due: "2026-10-23", type: "Events" },
    ],
  },
  {
    name: "Podjetniška/AI poletna šola",
    description: "Brezplačna večdnevna podjetniška šola z nočitvami: predavanja, delavnice in ekipe, ki z mentorjem razvijejo idejo do predstavitve žiriji.",
    tasks: [
      { title: "Sestavi seznam predavateljev za poletno šolo 2027", owner: dept("Core"), status: "todo", due: "2027-01-31", type: "Events" },
      { title: "Poišči lokacijo z nočitvami", owner: person("luka.novak"), status: "in_progress", due: "2026-12-15", type: "Events", priority: "urgent" },
      { title: "Pripravi proračun poletne šole", owner: person("maja.horvat"), status: "todo", due: "2026-11-30", type: "Finance" },
      { title: "Pripravi prijavnico za udeležence", owner: dept("Tech"), status: "todo", due: "2027-02-15", type: "Other", priority: "low" },
      { title: "Zberi mentorje za ekipe", owner: null, status: "todo", due: null, type: "Other", priority: "low" },
    ],
  },
  {
    name: "Mesečni dogodki",
    description: "Vsak mesec brezplačno predavanje ali pogovor z gostom iz podjetništva ali tehnologije, za člane pa še strokovne delavnice.",
    tasks: [
      { title: "Povabi gosta za decembrsko predavanje", owner: person("eva.vidmar"), status: "in_progress", due: "2026-11-05", type: "Events" },
      { title: "Pripravi vprašanja za moderiran pogovor", owner: person("sara.mlakar"), status: "todo", due: "2026-11-20", type: "Content" },
      { title: "Zmontiraj kratek video z oktobrskega dogodka", owner: dept("Voice"), status: "todo", due: "2026-10-29", type: "Marketing", priority: "urgent" },
      { title: "Organiziraj delavnico o projektnem vodenju za člane", owner: dept("Core"), status: "todo", due: "2026-12-03", type: "Events", priority: "low" },
      { title: "Preveri mikrofone in kamere pred dogodkom", owner: dept("Tech"), status: "done", due: "2026-10-22", type: "Other" },
    ],
  },
  {
    name: "AI delavnice",
    description: "Brezplačne vikend delavnice za mlade, od promptinga in AI agentov do vibe codinga, s hekatonom na koncu.",
    tasks: [
      { title: "Pripravi izzive za hekaton", owner: dept("Tech"), status: "in_progress", due: "2026-11-14", type: "Content" },
      { title: "Uredi prijavnico in pošlji opomnike udeležencem", owner: person("nejc.kralj"), status: "todo", due: "2026-11-07", type: "Other" },
      { title: "Promoviraj delavnico na družbenih omrežjih", owner: dept("Voice"), status: "todo", due: "2026-11-01", type: "Marketing" },
      { title: "Pripravi gradivo za sklop o AI agentih", owner: person("rok.golob"), status: "verification", due: "2026-10-31", type: "Content" },
      { title: "Poišči sponzorja za nagrade hekatona", owner: person("ana.kovac"), status: "todo", due: "2026-11-10", type: "Finance" },
    ],
  },
  {
    name: "Dogodek za Shaperje in partnerje",
    description: "Dogodek decembra in junija, kjer se Shaperji srečajo s partnerji, se jim zahvalijo in predstavijo zadnje polletje.",
    tasks: [
      { title: "Pripravi seznam gostov in pošlji vabila partnerjem", owner: person("petra.jerman"), status: "todo", due: "2026-11-15", type: "Events" },
      { title: "Zberi dosežke projektov za predstavitev polletja", owner: dept("Core"), status: "todo", due: "2026-12-01", type: "Content" },
      { title: "Uredi prostor, hrano in logistiko", owner: null, status: "todo", due: "2026-11-25", type: "Events" },
      { title: "Pripravi program večera", owner: person("aljaz.hribar"), status: "todo", due: "2026-12-05", type: "Events" },
      { title: "Pošlji zahvale s fotografijami po junijskem dogodku", owner: person("katja.lesjak"), status: "done", due: "2026-07-01", type: "Marketing" },
    ],
  },
  {
    name: "Povezovanje talentov s podjetji",
    description: "Podjetjem, ki iščejo mlad kader, pomagamo opredeliti potrebe in jim predlagamo talente iz naše mreže.",
    tasks: [
      { title: "Poišči tri podjetja, ki iščejo mlad kader", owner: person("urban.petek"), status: "in_progress", due: "2026-11-08", type: "Other" },
      { title: "Opredeli profil kandidata s prvim podjetjem", owner: dept("Core"), status: "todo", due: "2026-11-20", type: "Other" },
      { title: "Posodobi bazo talentov iz šolskih delavnic", owner: dept("Tech"), status: "todo", due: null, type: "Other" },
      { title: "Vodi intervjuje s kandidati", owner: person("jan.potocnik"), status: "todo", due: "2026-12-10", type: "Other" },
    ],
  },
];

// The stand-ins the seed created before the real project names were known.
const OLD_PLACEHOLDER_DESCRIPTION = "Placeholder project (the real project names were not in the sandbox data)%";

export async function addTeamProjects(): Promise<{ projects: number; tasks: number; removedPlaceholders: number }> {
  // Old placeholder projects go, but only while they have no tasks.
  const oldOnes = await db.select({ id: projects.id }).from(projects).where(like(projects.description, OLD_PLACEHOLDER_DESCRIPTION));
  let removedPlaceholders = 0;
  for (const p of oldOnes) {
    const [used] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, p.id)).limit(1);
    if (!used) {
      await db.delete(projects).where(eq(projects.id, p.id));
      removedPlaceholders++;
    }
  }

  await db
    .insert(projects)
    .values(TEAM_PROJECTS.map((p) => ({ name: p.name, description: p.description })))
    .onConflictDoNothing();
  const projectIds = new Map(
    (await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.name, TEAM_PROJECTS.map((p) => p.name)))).map(
      (p) => [p.name, p.id],
    ),
  );
  const emails = TEAM_PROJECTS.flatMap((p) => p.tasks.flatMap((t) => (t.owner && "email" in t.owner ? [t.owner.email] : [])));
  const memberIds = new Map(
    (await db.select({ id: members.id, email: members.email }).from(members).where(and(inArray(members.email, emails), eq(members.active, true)))).map(
      (m) => [m.email, m.id],
    ),
  );
  const departmentIds = new Map((await db.select({ id: departments.id, name: departments.name }).from(departments)).map((d) => [d.name, d.id]));

  let created = 0;
  for (const p of TEAM_PROJECTS) {
    const projectId = projectIds.get(p.name)!;
    const [hasTasks] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)).limit(1);
    if (hasTasks) continue;
    await db.transaction(async (tx) => {
      for (const t of p.tasks) {
        const assigneeId = t.owner && "email" in t.owner ? (memberIds.get(t.owner.email) ?? null) : null;
        const departmentId = t.owner && "department" in t.owner ? (departmentIds.get(t.owner.department) ?? null) : null;
        // A finished task was finished on its due date (so it counts in "finished tasks") and created two weeks before.
        const doneAt = t.status === "done" && t.due ? new Date(`${t.due}T10:00:00Z`) : null;
        const createdAt = doneAt ? new Date(doneAt.getTime() - 14 * 86_400_000) : new Date();
        const [task] = await tx
          .insert(tasks)
          .values({ title: t.title, status: t.status, priority: t.priority ?? DEFAULT_PRIORITY, assigneeId, departmentId, projectId, type: t.type, dueDate: t.due, source: "app", createdAt })
          .returning({ id: tasks.id });
        await tx
          .insert(taskEvents)
          .values({ taskId: task.id, actorId: null, source: "app", kind: "created", newValue: "Placeholder task (sample data)", createdAt });
        if (doneAt) {
          await tx.insert(taskEvents).values({
            taskId: task.id,
            actorId: assigneeId,
            source: "app",
            kind: "updated",
            field: "status",
            oldValue: STATUS_LABELS.in_progress,
            newValue: STATUS_LABELS.done,
            createdAt: doneAt,
          });
        }
        created++;
      }
    });
  }
  return { projects: projectIds.size, tasks: created, removedPlaceholders };
}
