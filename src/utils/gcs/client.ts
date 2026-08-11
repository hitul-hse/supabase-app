import { Storage } from "@google-cloud/storage";

let storage: Storage | null = null;

function getStorage() {
  if (!storage) {
    const credentials = JSON.parse(
      Buffer.from(process.env.GCS_SERVICE_ACCOUNT_KEY_BASE64!, "base64").toString("utf8"),
    );
    storage = new Storage({ credentials, projectId: credentials.project_id });
  }
  return storage;
}

export function getBucket() {
  return getStorage().bucket(process.env.GCS_BUCKET_NAME!);
}
