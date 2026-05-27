import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: {
    level: "info",
  },
});

app.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 1,
  },
}),

// -------------------- PLUGINS --------------------
app.register(cors, {
  const PORT = Number(process.env.PORT) || 3001;

app,listen({
  port: PORT,
  host: "0.0.0.0",
});
const uploadDir = path.join(__dirname, "uploads");
const processedDir = path.join(__dirname, "processed");

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(processedDir, { recursive: true });

app.register(fastifyStatic, {
  root: processedDir,
  prefix: "/files/",
});

// -------------------- HEALTH CHECK --------------------
app.get("/", async () => {
  return { status: "Audio backend running" };
});

// -------------------- MASTER ROUTE --------------------
app.post("/master", async (req, reply) => {

  try {
    const file = await req.file();
    
    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }
    if (!file.mimetype.includes("audio")) {
  return reply.code(400).send({
    error: "Only audio files allowed",
  });
}
    const fileName = `${Date.now()}-${file.filename}`;
    const uploadPath = path.join(uploadDir, fileName);

    const processedFileName = `mastered-${fileName}`;
    const processedPath = path.join(processedDir, processedFileName);

    // Save uploaded file
    const writeStream = fs.createWriteStream(uploadPath);
    await file.file.pipe(writeStream);
    await fs.promises.writeFile(uploadPath, buffer);

    console.log("UPLOAD SAVED:", uploadPath);

    // -------------------- FFmpeg PROCESS --------------------
    await new Promise<void>((resolve, reject) => {
  const cmd = `ffmpeg -y -i "${uploadPath}" -af "loudnorm=I=-14:TP=-1.5:LRA=11,acompressor" "${processedPath}"`;

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error("FFMPEG FAILED:", stderr);
      return reject(err);
    }
    resolve();
  });
});

    // -------------------- RESPONSE --------------------
    return {
      success: true,
      original: fileName,
      mastered: processedFileName,
      downloadUrl: `https://ai-mastering-backend.onrender.com${processedFileName}`,
    };
  } catch (err: any) {
    console.error("MASTERING FAILED:", err);

    return reply.code(500).send({
      error: "Processing failed",
      details: err?.message || String(err),
    });
  }
});

// -------------------- START SERVER --------------------
app.listen({ port: 3001, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log(`Server running at ${address}`);
});
setTimeout(() => {
  fs.unlink(uploadPath, () => {});
  fs.unlink(processedPath, () => {});
}, 1000 * 60 * 10); // 10 min
app.get("/health", async () => {
  return {
    status: "ok",
    uptime: process.uptime(),
  };
});