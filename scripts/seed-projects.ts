// Adds the institute's running projects with placeholder tasks (see team-projects.ts). Safe to re-run.
// Usage: npm run seed:projects
import "dotenv/config";
import { addTeamProjects } from "./team-projects";

addTeamProjects()
  .then((r) => {
    console.log(`projects: ${r.projects} team projects, ${r.tasks} placeholder tasks added, ${r.removedPlaceholders} old placeholder projects removed`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
