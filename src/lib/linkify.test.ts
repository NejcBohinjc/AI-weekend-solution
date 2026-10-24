import assert from "node:assert/strict";
import { test } from "node:test";
import { splitLinks } from "./linkify";

test("finds links and leaves the rest as text", () => {
  assert.deepEqual(splitLinks("Agenda: https://docs.example.org/a?b=1&c=2 and www.example.org."), [
    { text: "Agenda: " },
    { text: "https://docs.example.org/a?b=1&c=2", href: "https://docs.example.org/a?b=1&c=2" },
    { text: " and " },
    { text: "www.example.org", href: "https://www.example.org" },
    { text: "." },
  ]);
});

test("keeps brackets that belong to the address, drops trailing punctuation", () => {
  assert.deepEqual(splitLinks("(see https://en.wikipedia.org/wiki/Foo_(bar))"), [
    { text: "(see " },
    { text: "https://en.wikipedia.org/wiki/Foo_(bar)", href: "https://en.wikipedia.org/wiki/Foo_(bar)" },
    { text: ")" },
  ]);
  assert.deepEqual(splitLinks("Call: https://meet.example.org/x, then"), [
    { text: "Call: " },
    { text: "https://meet.example.org/x", href: "https://meet.example.org/x" },
    { text: ", then" },
  ]);
});

test("only http(s) and www links, never javascript:", () => {
  assert.deepEqual(splitLinks("javascript:alert(1)"), [{ text: "javascript:alert(1)" }]);
  assert.deepEqual(splitLinks("no links here"), [{ text: "no links here" }]);
});
