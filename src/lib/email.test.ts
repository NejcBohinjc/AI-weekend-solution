// Database test (runs on the *_test database): sendEmail against fake SMTP servers on localhost, a silent
// one (accepts the connection, never says hello), one that refuses, and one that works. Timeouts are
// shortened with SMTP_TIMEOUT_MS so the silent server cannot hold the test (or, in production, a request
// or the reminder job) up.
import "dotenv/config";
import assert from "node:assert/strict";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import { desc, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { emailLog, members } from "@/db/schema";
import { testDatabaseSkip } from "@/lib/test-db";
import { sendEmail, sendTestEmail, smtpTimeoutMs } from "./email";

const mail = { memberId: null, to: "someone@sandbox.example", subject: "Hello", text: "Hi", html: "<p>Hi</p>" };

const servers: { close: () => void }[] = [];

function fakeSmtp(behaviour: "silent" | "busy" | "ok"): Promise<{ port: number; close: () => void; sockets: Set<net.Socket>; received: string[] }> {
  const sockets = new Set<net.Socket>();
  const received: string[] = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    if (behaviour === "silent") return; // never greets
    if (behaviour === "busy") return void socket.end("421 4.3.2 Service not available, try later\r\n");
    socket.write("220 fake ESMTP\r\n");
    let data = false;
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (data) {
          if (line === ".") {
            data = false;
            socket.write("250 queued\r\n");
          } else received.push(line);
        } else if (/^EHLO/i.test(line)) socket.write("250-fake\r\n250 8BITMIME\r\n");
        else if (/^(MAIL|RCPT)/i.test(line)) socket.write("250 ok\r\n");
        else if (/^DATA/i.test(line)) {
          data = true;
          socket.write("354 go\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  const close = () => {
    for (const s of sockets) s.destroy();
    server.close();
  };
  servers.push({ close }); // closed in after() even if a test fails before it calls close()
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, sockets, received, close })),
  );
}

describe("email over SMTP", { skip: testDatabaseSkip() }, () => {
  let admin: { id: number; name: string; email: string };
  before(async () => {
    const [m] = await db
      .insert(members)
      .values({ name: "Ana Admin", email: `email.test.${Date.now()}@sandbox.example`, tier: "Core", weeklyHours: 70, isAdmin: true })
      .returning({ id: members.id, name: members.name, email: members.email });
    admin = m;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_TIMEOUT_MS = "400";
    delete process.env.MAIL_REDIRECT_TO;
    delete process.env.SMTP_USER;
  });
  after(async () => {
    for (const srv of servers) srv.close();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_TIMEOUT_MS;
    await db.delete(emailLog).where(eq(emailLog.to, mail.to));
    await db.delete(members).where(eq(members.id, admin.id));
    await closeDb();
  });

  test("the timeout defaults to 10 s and can be changed", () => {
    delete process.env.SMTP_TIMEOUT_MS;
    assert.equal(smtpTimeoutMs(), 10_000);
    process.env.SMTP_TIMEOUT_MS = "400";
    assert.equal(smtpTimeoutMs(), 400);
  });

  test("a server that never says hello fails within the timeout, with the error text in email_log", async () => {
    const smtp = await fakeSmtp("silent");
    process.env.SMTP_PORT = String(smtp.port);
    const t0 = Date.now();
    const r = await sendEmail(mail);
    const took = Date.now() - t0;
    smtp.close();
    assert.equal(r.status, "failed");
    assert.ok(took < 3000, `gave up after ${took} ms`);
    assert.match(r.error ?? "", /timeout|never received|ETIMEDOUT|ETIMEOUT/i);
    const [row] = await db.select().from(emailLog).where(eq(emailLog.id, r.id));
    assert.deepEqual([row.status, row.error], ["failed", r.error]);
  });

  test("a server that refuses the connection fails with its message", async () => {
    const smtp = await fakeSmtp("busy");
    process.env.SMTP_PORT = String(smtp.port);
    const r = await sendEmail(mail);
    smtp.close();
    assert.equal(r.status, "failed");
    assert.match(r.error ?? "", /421|Service not available/);
  });

  test("a working server gets the message; the test email goes to the admin", async () => {
    const smtp = await fakeSmtp("ok");
    process.env.SMTP_PORT = String(smtp.port);
    const r = await sendEmail(mail);
    assert.equal(r.status, "sent");
    assert.equal(r.to, mail.to);
    const test = await sendTestEmail(admin);
    smtp.close();
    assert.equal(test.status, "sent");
    assert.equal(test.to, admin.email);
    assert.ok(smtp.received.some((l) => l.includes("Hello Ana Admin")));
    const [last] = await db.select().from(emailLog).orderBy(desc(emailLog.id)).limit(1);
    assert.equal(last.subject, "Test email from Shapers Hub");
    await db.delete(emailLog).where(eq(emailLog.to, admin.email));
  });

  test("MAIL_REDIRECT_TO receives the test email, and without SMTP_HOST it is only recorded", async () => {
    const smtp = await fakeSmtp("ok");
    process.env.SMTP_PORT = String(smtp.port);
    process.env.MAIL_REDIRECT_TO = "inbox@sandbox.example";
    const r = await sendTestEmail(admin);
    smtp.close();
    assert.deepEqual([r.status, r.to], ["sent", "inbox@sandbox.example"]);
    delete process.env.SMTP_HOST;
    const logged = await sendTestEmail(admin);
    assert.equal(logged.status, "logged");
    delete process.env.MAIL_REDIRECT_TO;
    process.env.SMTP_HOST = "127.0.0.1";
    await db.delete(emailLog).where(eq(emailLog.to, "inbox@sandbox.example"));
    await db.delete(emailLog).where(eq(emailLog.to, admin.email));
  });
});
