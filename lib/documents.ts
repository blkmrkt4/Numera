import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_BYTES = 26_214_400; // 25 MB

export const ACCEPTED_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
};

export const ACCEPT_ATTRIBUTE = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  ".heif",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
].join(",");

export type UploadResult =
  | { ok: true; documentId: string; storagePath: string }
  | { ok: false; error: string };

/**
 * Validate, upload to storage, and insert a `documents` row.
 * Uses the caller's authenticated supabase client — storage RLS and table
 * RLS together ensure the file lands under the caller's household_id
 * prefix and the document row carries the right household_id.
 */
export async function uploadDocument(
  supabase: SupabaseClient,
  householdId: string,
  userId: string,
  file: File
): Promise<UploadResult> {
  if (!file || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File is too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB).` };
  }

  const ext = ACCEPTED_MIME[file.type];
  if (!ext) {
    return {
      ok: false,
      error: `Unsupported file type. Accepted: PDF, JPEG, PNG, HEIC, XLS, XLSX, CSV.`,
    };
  }

  const documentId = randomUUID();
  const storagePath = `${householdId}/${documentId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  const { error: rowError } = await supabase.from("documents").insert({
    id: documentId,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: userId,
  });

  if (rowError) {
    // best-effort cleanup of the orphaned object
    await supabase.storage.from("documents").remove([storagePath]);
    return { ok: false, error: `Could not save document: ${rowError.message}` };
  }

  return { ok: true, documentId, storagePath };
}

/**
 * Issue a short-lived signed URL for viewing a stored document.
 * 15 minutes per PRD §6.1 ("short-lived signed URLs").
 */
export async function getSignedDocumentUrl(
  supabase: SupabaseClient,
  storagePath: string
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, 60 * 15);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Download a stored document and return it as a base64 data URL.
 * Used by lib/extraction.ts to ship the document content to a
 * vision-capable LLM. Never log or persist the returned string.
 */
export async function downloadDocumentAsDataUrl(
  supabase: SupabaseClient,
  storagePath: string,
  mimeType: string
): Promise<{ dataUrl: string; bytes: number } | null> {
  const { data, error } = await supabase.storage
    .from("documents")
    .download(storagePath);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  const base64 = buffer.toString("base64");
  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    bytes: buffer.length,
  };
}
