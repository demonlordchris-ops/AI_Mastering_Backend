import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { spawn } from "child_process";
import { pipeline } from "stream/promises";

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
// FASTIFY APP
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

await app.register(rateLimit, {
  max: 20,
  timeWindow: "1 minute",
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
// JOB SYSTEM
// --------------------------------------------------

const jobs = new Map();
let activeJobs = 0;

const MAX_CONCURRENT_JOBS = 2;
const JobStatus = {
  QUEUED: "queued",
  PROCESSING: "processing",
  DONE: "done",
  ERROR: "error",
};

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

```js

function processJob(jobId, inputPath, outputPath) {
  const filters = [
    "highpass=f=30",
    "lowpass=f=18000",
    "acompressor=threshold=-16dB:ratio=2:attack=20:release=200",
    "loudnorm=I=-14:TP=-1.5:LRA=11",
  ].join(",");

  const args = [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-af",
    filters,
    "-progress",
    "pipe:1",
    "-nostats",
    "-ar",
    "44100",
    "-b:a",
    "320k",
    outputPath,
  ];

  const ffmpeg = spawn("ffmpeg", args);

  activeJobs++;

  const timeout = setTimeout(() => {
    console.error("FFmpeg timeout for job", jobId);

    ffmpeg.kill("SIGKILL");

    const currentJob = jobs.get(jobId);

    if (!currentJob) return;

    jobs.set(jobId, {
      ...currentJob,
      status: JobStatus.ERROR,
      error: "Processing timeout",
    });

  }, 1000 * 60 * 5);

  let progress = 0;

  ffmpeg.stdout.on("data", () => {
    progress = Math.min(progress + 5, 95);

    const currentJob = jobs.get(jobId);

    if (!currentJob) return;

    jobs.set(jobId, {
      ...currentJob,
      progress,
    });
  });

  ffmpeg.stderr.on("data", (data) => {
    console.log(data.toString());
  });

  ffmpeg.on("close", (code) => {
    activeJobs = Math.max(0, activeJobs - 1);

    clearTimeout(timeout);

    const currentJob = jobs.get(jobId);

    cleanup(inputPath, outputPath);

    if (!currentJob) return;

    if (code === 0) {
      jobs.set(jobId, {
        ...currentJob,
        status: JobStatus.DONE,
        progress: 100,
        error: null,
      });
    } else {
      jobs.set(jobId, {
        ...currentJob,
        status: JobStatus.ERROR,
        error: "FFmpeg processing failed",
      });
    }
  });

  ffmpeg.on("error", (err) => {
    activeJobs = Math.max(0, activeJobs - 1);

    clearTimeout(timeout);

    cleanup(inputPath, outputPath);

    const currentJob = jobs.get(jobId);

    if (!currentJob) return;

    jobs.set(jobId, {
      ...currentJob,
      status: JobStatus.ERROR,
      error: err.message,
    });
  });
}
```


  ffmpeg.on("error", (err) => {
    activeJobs = Math.max(0, activeJobs - 1);

    clearTimeout(timeout);

    cleanup(inputPath, outputPath);

    const currentJob = jobs.get(jobId);

    if (!currentJob) return;

    jobs.set(jobId, {
      ...currentJob,
      status: JobStatus.ERROR,
      error: err.message,
    });
  })
}

    // -------------------------------
    // SAVE FILE
    // -------------------------------

    await pipeline(file.file, fs.createWriteStream(uploadPath));

    // -------------------------------
    // UPDATE STATUS
    // -------------------------------

    jobs.set(jobId, {
      ...jobs.get(jobId),
      status: JobStatus.PROCESSING,
    });

    // -------------------------------
    // START FFMPEG
    // -------------------------------

    processJob(jobId, uploadPath, outputPath);

    // -------------------------------
    // RESPONSE
    // -------------------------------

app.post("/master", async (req, reply) => {
  try {

    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      return reply.code(503).send({
        error: "Server busy. Try again shortly.",
      });
    }

    const file = await req.file();

    if (!file) {
      return reply.code(400).send({
        error: "No file uploaded",
      });
    }

    const allowedMime = [
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/flac",
      "audio/mp4",
      "audio/aac",
      "audio/ogg",
    ];

    const allowedExtensions = [
      ".mp3",
      ".wav",
      ".flac",
      ".m4a",
      ".aac",
      ".ogg",
    ];

    if (!allowedMime.includes(file.mimetype)) {
      return reply.code(400).send({
        error: "Unsupported audio format",
      });
    }

    const ext = path.extname(file.filename).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      return reply.code(400).send({
        error: "Unsupported file extension",
      });
    }

    const jobId = crypto.randomUUID();

    const uploadName = safeFilename(file.filename);

    const outputName = `mastered-${uploadName}.mp3`;

    const uploadPath = path.join(uploadDir, uploadName);

    const outputPath = path.join(processedDir, outputName);

    jobs.set(jobId, {
      id: jobId,
      status: JobStatus.QUEUED,
      progress: 0,
      file: outputName,
      error: null,
    });

    await pipeline(
      file.file,
      fs.createWriteStream(uploadPath)
    );

    jobs.set(jobId, {
      ...jobs.get(jobId),
      status: JobStatus.PROCESSING,
    });

    processJob(jobId, uploadPath, outputPath);

    return {
      success: true,
      jobId,
      statusUrl: `/status/${jobId}`,
      downloadUrl: `/files/${outputName}`,
    };

  } catch (err) {
    console.error(err);

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