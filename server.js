import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import fs from "fs";
import path from "path";
import { exec } from "child_process";
import ffmpeg from "ffmpeg";
import { fileURLToPath } from "url";

// -------------------- PATH SETUP --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------- APP --------------------
const app = Fastify({
  logger: true,
});

// -------------------- DIRECTORIES --------------------
const uploadDir = path.join(__dirname, "uploads");
const processedDir = path.join(__dirname, "processed");

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(processedDir, { recursive: true });

// -------------------- PLUGINS --------------------
app.register(cors, { origin: true });

app.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1,
  },
});

app.register(fastifyStatic, {
  root: processedDir,
  prefix: "/files/",
});

// -------------------- HEALTH --------------------
app.get("/", async () => {
  return { status: "Audio backend running" };
});

app.get("/health", async () => {
  return {
    status: "ok",
    uptime: process.uptime(),
  };
});

// -------------------- MASTER ROUTE --------------------
app.post("/master", async (req, reply) => {
  try {
    const file = await req.file();

    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    if (!file.mimetype.includes("audio")) {
      return reply.code(400).send({ error: "Only audio files allowed" });
    }

    const fileName = `${Date.now()}-${file.filename}`;
    const uploadPath = path.join(uploadDir, fileName);

    const processedFileName = `mastered-${fileName}`;
    const processedPath = path.join(processedDir, processedFileName);

    // Save upload
    const buffer = await file.toBuffer();
    await fs.promises.writeFile(uploadPath, buffer);

    console.log("UPLOAD SAVED:", uploadPath);

    // -------------------- FFmpeg --------------------
    const cmd = `"${ffmpeg}" -y -i "${uploadPath}" -af "loudnorm=I=-14:TP=-1.5:LRA=11,acompressor" "${processedPath}"`;

    await new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error("FFMPEG ERROR:", stderr);
          return reject(err);
        }
        resolve();
      });
    });

    // cleanup after 10 minutes
    setTimeout(() => {
      fs.unlink(uploadPath, () => {});
      fs.unlink(processedPath, () => {});
    }, 1000 * 60 * 10);

    return {
      success: true,
      original: fileName,
      mastered: processedFileName,
      downloadUrl: `/files/${processedFileName}`,
    };
  } catch (err) {
    console.error("MASTERING FAILED:", err);

    return reply.code(500).send({
      error: "Processing failed",
      details: err.message || String(err),
    });
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3001;

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log(`Server running at ${address}`);
});