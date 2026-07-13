import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createFolder, initializeProject } from "../services/folder.service.js";
import { enqueueEvent } from "../services/webhook.service.js";

const createSchema = z.object({
  path: z.string().max(1024),
  name: z.string().min(1).max(120),
});

const projectSchema = z.object({
  projectId: z.string().uuid(),
  projectCode: z.string().min(1).max(60),
  projectName: z.string().min(1).max(120),
});

export async function folderRoutes(app: FastifyInstance) {
  app.post("/api/v1/folders", async (req, reply) => {
    const body = createSchema.parse(req.body);
    req.auditPath = `${body.path}/${body.name}`;
    const result = await createFolder(body.path, body.name);
    if (result.created) enqueueEvent({ eventType: "FOLDER_CREATED", relativePath: result.relativePath });
    return reply.send(result);
  });

  app.post("/api/v1/projects/initialize", async (req, reply) => {
    const body = projectSchema.parse(req.body);
    req.auditPath = body.projectCode;
    const result = await initializeProject(body.projectCode, body.projectName);
    if (result.created) {
      enqueueEvent({ eventType: "FOLDER_CREATED", relativePath: result.relativePath });
      for (const sub of result.subfolders) {
        enqueueEvent({ eventType: "FOLDER_CREATED", relativePath: sub });
      }
    }
    return reply.send({ ...result, projectId: body.projectId });
  });
}
