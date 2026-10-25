// Performance tool: a TCP proxy that adds a fixed one-way delay to every chunk (order kept): stands in for the network
// between Vercel and a hosted Postgres. Usage: node delay-proxy.mjs <listenPort> <targetPort> <oneWayMs>
import net from "node:net";
const [listen, target, delay] = process.argv.slice(2).map(Number);
net.createServer((client) => {
  const upstream = net.connect(target, "127.0.0.1");
  const pipe = (from, to) => {
    let last = 0;
    from.on("data", (chunk) => {
      const at = Math.max(Date.now() + delay, last);
      last = at;
      setTimeout(() => to.writable && to.write(chunk), at - Date.now());
    });
    from.on("end", () => setTimeout(() => to.end(), delay));
    from.on("error", () => to.destroy());
  };
  pipe(client, upstream);
  pipe(upstream, client);
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
}).listen(listen, () => console.log(`delay proxy :${listen} -> :${target}, ${delay} ms each way`));
