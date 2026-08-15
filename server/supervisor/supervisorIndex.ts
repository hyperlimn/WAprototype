import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ServiceSupervisor, SUPERVISOR_HOST, SUPERVISOR_PORT } from "./serviceSupervisor.js";
import { corsHeaders } from "../cors.js";

const supervisor = new ServiceSupervisor();
const json = (response: ServerResponse, status: number, value: unknown): void => { response.writeHead(status, { "Content-Type": "application/json", ...corsHeaders("GET, POST, OPTIONS") }); response.end(JSON.stringify(value)); };
const localOrigin = (request: IncomingMessage): boolean => !request.headers.origin || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(request.headers.origin);
const server = createServer(async (request, response) => {
  if (!localOrigin(request)) return json(response, 403, { error: "supervisor_origin_forbidden" });
  if (request.method === "OPTIONS") return json(response, 204, null);
  if (request.method === "GET" && request.url === "/api/supervisor/status") return json(response, 200, await supervisor.runtimeDiagnostics());
  if (request.method === "GET" && request.url === "/api/supervisor/runs") return json(response, 200, { runs: supervisor.list() });
  if (request.method === "GET" && request.url === "/api/supervisor/save-states") {
    try { return json(response, 200, await supervisor.listSaveStates()); }
    catch (error) { return json(response, 409, { error: "save_state_catalog_unavailable", message: error instanceof Error ? error.message : "unavailable" }); }
  }
  if (request.method === "POST" && request.url === "/api/supervisor/run") {
    try { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (body.commandId === "universe.delete-save") { const run = await supervisor.deleteSave(body.commandId, body.saveId);
        return run.status === "completed" ? json(response, 200, { run }) : json(response, 409, { error: "save_delete_refused", message: run.error ?? "Save deletion failed", run }); }
      const run = body.commandId === "runtime.restart-all" ? supervisor.beginRestartAll(body.commandId)
        : body.commandId === "runtime.resume-save" ? supervisor.beginResumeSave(body.commandId, body.saveId)
        : await supervisor.startOrRestart(body.commandId);
      return json(response, 202, { run }); }
    catch (error) { return json(response, 409, { error: "service_action_refused", message: error instanceof Error ? error.message : "refused" }); }
  }
  return json(response, 404, { error: "not_found" });
});
server.listen(SUPERVISOR_PORT, SUPERVISOR_HOST, () => {
  console.log(`ProtoUniverse service supervisor listening at http://${SUPERVISOR_HOST}:${SUPERVISOR_PORT}`);
  void supervisor.startInitialStack().catch((error) => console.warn(`Runtime autostart refused: ${error instanceof Error ? error.message : error}`));
});
