import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import { Select } from "@cliffy/prompt";
import { Command } from "@cliffy/command";
import { walk } from "@std/fs";
import { basename, join, extname } from "@std/path";
import { contentType } from "@std/media-types";

const s3 = new S3Client({
  region: "auto",
  endpoint: Deno.env.get("R2_ENDPOINT"),
  credentials: {
    accessKeyId: Deno.env.get("R2_ACCESS_KEY")!,
    secretAccessKey: Deno.env.get("R2_SECRET_KEY")!,
  },
});

async function convertToWebP(inputPath: string, quality = 80): Promise<string> {
  const tempDir = await Deno.makeTempDir();
  const outputPath = join(
    tempDir,
    basename(inputPath, extname(inputPath)) + ".webp"
  );

  const cmd = new Deno.Command("convert", {
    args: [inputPath, "-quality", String(quality), outputPath],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    const errorString = new TextDecoder().decode(stderr);
    throw new Error(`WebP conversion failed: ${errorString}`);
  }

  return outputPath;
}

async function getImageDimensions(path: string) {
  const cmd = new Deno.Command("identify", {
    args: ["-format", "%w %h", path],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();

  if (code !== 0) {
    const errorString = new TextDecoder().decode(stderr);
    throw new Error(`identify failed: ${errorString}`);
  }

  const output = new TextDecoder().decode(stdout).trim();
  const [width, height] = output.split(" ");

  return { width, height };
}

async function uploadFile(
  bucket: string,
  key: string,
  filePath: string,
  isCover: boolean
) {
  const ext = extname(filePath).toLowerCase();
  const uploadPath = await convertToWebP(filePath);
  const file = await Deno.readFile(uploadPath);
  const dimensions = await getImageDimensions(filePath);
  const Metadata = { ...dimensions, cover: String(isCover) };
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key.replace(ext, ".webp"),
    Body: file,
    ContentType: contentType(".webp"),
    Metadata,
  });

  await s3.send(command);
  console.log(`✅ Uploaded ${key}${isCover ? " (cover)" : ""}`);
}

async function main(folder: string) {
  const bucket = Deno.env.get("R2_BUCKET")!;
  const remotePrefix = basename(folder) + "/";
  const files: string[] = [];

  for await (const entry of walk(folder, { maxDepth: 1, includeFiles: true })) {
    if (!entry.isFile) continue;
    files.push(entry.path);
  }

  const selectedCover = await Select.prompt({
    message: "Select the cover image",
    options: files.map((file) => ({ name: basename(file), value: file })),
  });

  for (const filePath of files) {
    const filename = basename(filePath);
    const key = remotePrefix + filename;
    const isCover = filePath === selectedCover;
    await uploadFile(bucket, key, filePath, isCover);
  }
}

await new Command()
  .name("upload-folder")
  .version("1.0.0")
  .description("Upload a folder to R2 and select a cover image")
  .arguments("<folder:string>")
  .action(async (_: any, folder: string) => {
    await main(folder);
  })
  .parse(Deno.args);
