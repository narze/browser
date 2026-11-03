import { createServer } from "node:http";

export async function startFixture() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture");
    if (url.pathname === "/redirect") {
      response.writeHead(302, { Location: "/second" });
      response.end();
      return;
    }
    if (url.pathname === "/slow") {
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.write("<title>Slow page</title><h1>Loading</h1>");
      const timer = setTimeout(() => response.end("<p>Finished</p>"), 5000);
      response.on("close", () => clearTimeout(timer));
      return;
    }
    if (url.pathname === "/worker.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end("onmessage = e => postMessage(e.data * 2)");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    const title = url.pathname === "/second" ? "Second page" : "Fixture page";
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font:16px system-ui;padding:24px;background:#f3f6fa;color:#263448}a,button{margin-right:16px}.card{padding:8px;border:1px solid #ccd4e0}</style></head>
      <body><h1>${title}</h1><a id="next" href="/second">Next page</a><a id="popup" href="/second" target="_blank">Open tab</a>
      <input id="editable" aria-label="Editable text"><button id="counter" onclick="this.textContent=Number(this.textContent)+1">0</button>
      <div id="grid"></div><script>
      window.fixtureToken = crypto.randomUUID();
      const fragment = document.createDocumentFragment();
      for(let i=0;i<300;i++){const row=document.createElement('div');row.className='card';row.textContent='Browser benchmark row '+i;fragment.append(row)}
      document.querySelector('#grid').append(fragment);
      requestAnimationFrame(()=>requestAnimationFrame(()=>window.fixtureReady=true));
      </script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
