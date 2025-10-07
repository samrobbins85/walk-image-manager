import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import { Select } from "@cliffy/prompt";
import { Command } from "@cliffy/command";
import { walk } from "@std/fs";
import { basename } from "@std/path";
import { contentType } from "@std/media-types";

const s3 = new S3Client({
  region: "auto",
  endpoint: Deno.env.get("R2_ENDPOINT"),
  credentials: {
    accessKeyId: Deno.env.get("R2_ACCESS_KEY")!,
    secretAccessKey: Deno.env.get("R2_SECRET_KEY")!,
  },
});

async function uploadFile(
  bucket: string,
  key: string,
  filePath: string,
  isCover: boolean
) {
  const file = await Deno.readFile(filePath);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file,
    ContentType:
      contentType("." + filePath.split(".").at(-1)!) ??
      "application/octet-stream",
    Metadata: isCover ? { cover: "true" } : {},
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
