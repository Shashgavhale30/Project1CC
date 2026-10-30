// Minimal container demo for ContactFlow. No dependencies, no database,
// no secrets: it only proves that a Docker-based Render service builds and runs.
const http = require("node:http");

const port = Number(process.env.PORT) || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        service: "contactflow-docker-test",
        status: "ok",
        runtime: "docker",
        node: process.version,
        path: req.url,
      }),
    );
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`contactflow-docker-test listening on port ${port}`);
  });
