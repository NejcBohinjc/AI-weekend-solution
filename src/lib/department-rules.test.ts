import assert from "node:assert/strict";
import { test } from "node:test";
import { departmentTierProblem, tierOfDepartment } from "./department-rules";

test("a department named like a tier is reserved for that tier", () => {
  assert.equal(tierOfDepartment("Core"), "Core");
  assert.equal(tierOfDepartment(" core "), "Core");
  assert.equal(tierOfDepartment("Tech"), null);
  assert.equal(tierOfDepartment("Voice"), null);
});

test("only Core-tier members may be in the Core department; any number of other departments, or none", () => {
  const core = { name: "Core" };
  const tech = { name: "Tech" };
  const voice = { name: "Voice" };
  assert.equal(departmentTierProblem([core, tech, voice], "Core"), null);
  assert.equal(departmentTierProblem([tech, voice], "Impact"), null);
  assert.equal(departmentTierProblem([], "GO!"), null);
  assert.equal(departmentTierProblem([tech, core], "GO!"), "Core is only for members of the Core tier.");
});
