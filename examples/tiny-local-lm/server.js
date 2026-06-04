import { createTinyLmServer } from "./src/server.js";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] ?? process.env.PORT ?? 8787);
const server = createTinyLmServer();

server.listen(port, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(`tiny-local-lm listening on http://127.0.0.1:${actualPort}\n`);
});
