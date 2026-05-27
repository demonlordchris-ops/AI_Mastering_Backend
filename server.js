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
// PATHS
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

function safeFilename(name) {
  const ext = path.extname(name);

  const id = crypto.randomBytes(8).toString("hex");

  return `${Date.now()}-${id}${ext}`;
}

function cleanup(...files) {
  for (const file of files) {
    fs.unlink(file, () => {});
  }
}

function runFFmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",

      "-i",
      input,

      "-af",
      [
        "highpass=f=30",
        "lowpass=f=18000",
        "acompressor=threshold=-16dB:ratio=2:attack=20:release=200",
        "loudnorm=I=-14:TP=-1.5:LRA=11",
      ].join(","),

      "-ar",
      "44100",

      "-b:a",
      "320k",

      output,
    ];

    const ffmpeg = spawn("ffmpeg", args, {
      windowsHide: true,
    });

    let stderr = "";

    const timeout = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
      reject(new Error("FFmpeg timeout"));
    }, 1000 * 60 * 5);

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        return reject(
          new Error(`FFmpeg exited with code ${code}\n${stderr}`)
        );
      }

      resolve();
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get("/", async () => {
  return {
    status: "Audio backend running",
  };
});

app.get("/health", async () => {
  return {
    status: "ok",
    uptime: process.uptime(),
  };
});

// --------------------------------------------------
// MASTER
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
    // VALIDATION
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
    // STREAM SAVE
    // ----------------------------------------------

    await pipeline(
      file.file,
      fs.createWriteStream(uploadPath)
    );

    req.log.info(`UPLOAD SAVED: ${uploadPath}`);

    // ----------------------------------------------
    // PROCESS AUDIO
    // ----------------------------------------------

    await runFFmpeg(uploadPath, processedPath);

    // ----------------------------------------------
    // AUTO CLEANUP
    // ----------------------------------------------

    setTimeout(() => {
      cleanup(uploadPath, processedPath);
    }, 1000 * 60 * 15);

    return {
      success: true,
      downloadUrl: `/files/${processedName}`,
      file: processedName,
    };
  } catch (err) {
    req.log.error(err);

    cleanup(uploadPath, processedPath);

    return reply.code(500).send({
      error: "Processing failed",
      details: err.message,
    });
  }
});

// --------------------------------------------------
// START
// --------------------------------------------------

const PORT = process.env.PORT || 3001;

try {
  await app.listen({
    port: PORT,
    host: "0.0.0.0",
  });

  console.log(`Server running on ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}