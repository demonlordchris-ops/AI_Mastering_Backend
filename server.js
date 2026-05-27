import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import fs from "fs";
import path from "path";
import crypto from "crypto";

import { pipeline } from "stream/promises";
import { spawn } from "child_process";

import { fileURLToPath } from "url";

// --------------------------------------------------
// PATH SETUP
// --------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, "uploads");
const processedDir = path.join(__dirname, "processed");

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(processedDir, { recursive: true });

// --------------------------------------------------
// APP
// --------------------------------------------------

const app = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024,
});

// --------------------------------------------------
// PLUGINS
// --------------------------------------------------

await app.register(cors, {
  origin: true,
});

await app.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1,
  },
});

await app.register(fastifyStatic, {
  root: processedDir,
  prefix: "/files/",
});

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function safeFilename(originalName = "audio.mp3") {
  const ext = path.extname(originalName) || ".mp3";

  const random = crypto.randomBytes(8).toString("hex");

  return `${Date.now()}-${random}${ext}`;
}

function cleanup(...files) {
  for (const file of files) {
    if (!file) continue;

    fs.unlink(file, () => {});
  }
}

function runFFmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const filters = [
      "highpass=f=30",
      "lowpass=f=18000",
      "acompressor=threshold=-16dB:ratio=2:attack=20:release=200",
      "loudnorm=I=-14:TP=-1.5:LRA=11",
    ].join(",");

    const args = [
      "-y",

      "-i",
      input,

      "-vn",

      "-af",
      filters,

      "-ar",
      "44100",

      "-b:a",
      "320k",

      output,
    ];

    const ffmpeg = spawn("ffmpeg", args);

    let stderr = "";

    const timeout = setTimeout(() => {
      ffmpeg.kill("SIGKILL");

      reject(new Error("FFmpeg processing timeout"));
    }, 1000 * 60 * 5);

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        return reject(
          new Error(`FFmpeg failed with code ${code}\n${stderr}`)
        );
      }

      resolve();
    });
  });
}

// --------------------------------------------------
// ROUTES
// --------------------------------------------------

app.get("/", async () => {
  return {
    status: "Audio mastering backend online",
  };
});

app.get("/health", async () => {
  return {
    status: "ok",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };
});

// --------------------------------------------------
// MASTER ENDPOINT
// --------------------------------------------------

app.post("/master", async (req, reply) => {
  let uploadPath = null;
  let processedPath = null;

  try {
    const file = await req.file();

    if (!file) {
      return reply.code(400).send({
        error: "No file uploaded",
      });
    }

    // ----------------------------------------------
    // MIME VALIDATION
    // ----------------------------------------------

    const allowedMime = [
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/flac",
      "audio/mp4",
      "audio/aac",
      "audio/ogg",
    ];

    if (!allowedMime.includes(file.mimetype)) {
      return reply.code(400).send({
        error: "Unsupported audio format",
      });
    }

    // ----------------------------------------------
    // SAFE FILENAMES
    // ----------------------------------------------

    const uploadName = safeFilename(file.filename);

    const processedName = `mastered-${uploadName}.mp3`;

    uploadPath = path.join(uploadDir, uploadName);

    processedPath = path.join(processedDir, processedName);

    // ----------------------------------------------
    // SAVE FILE STREAM
    // ----------------------------------------------

    await pipeline(
      file.file,
      fs.createWriteStream(uploadPath)
    );

    req.log.info(`Upload saved: ${uploadPath}`);

    // ----------------------------------------------
    // PROCESS AUDIO
    // ----------------------------------------------

    await runFFmpeg(uploadPath, processedPath);

    req.log.info(`Master complete: ${processedPath}`);

    // ----------------------------------------------
    // AUTO CLEANUP
    // ----------------------------------------------

    setTimeout(() => {
      cleanup(uploadPath, processedPath);
    }, 1000 * 60 * 15);

    return {
      success: true,
      file: processedName,
      downloadUrl: `/files/${processedName}`,
    };
  } catch (err) {
    req.log.error(err);

    cleanup(uploadPath, processedPath);

    return reply.code(500).send({
      error: "Processing failed",
      details: err.message || String(err),
    });
  }
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 3001;

try {
  await app.listen({
    port: PORT,
    host: "0.0.0.0",
  });

  console.log(`Server running on port ${PORT}`);
} catch (err) {
  app.log.error(err);

  process.exit(1);
}