"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { loadExistingForImport } from "@/lib/admin/data";
import { describeDbError, done, fail, withAdmin, type ActionResult } from "@/lib/admin/session";
import { MAX_CSV_BYTES } from "@/lib/import/csv";
import {
  IMPORT_KINDS,
  parseImportFiles,
  validateImport,
  type ImportFiles,
  type ImportReport,
} from "@/lib/import/validate";
import type { Json } from "@/types/database";

async function readFiles(formData: FormData): Promise<ImportFiles | string> {
  const files: ImportFiles = {};
  for (const kind of IMPORT_KINDS) {
    const entry = formData.get(kind);
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (entry.size > MAX_CSV_BYTES) return `${entry.name} is larger than ${MAX_CSV_BYTES / 1_000_000} MB.`;
    files[kind] = { name: entry.name.slice(0, 100), text: await entry.text() };
  }
  return files;
}

/** The report minus the payload, which can be large and is rebuilt on commit. */
const forClient = (report: ImportReport): ImportReport => ({ ...report, payload: null });

export type ImportPreview = { batchId: string; report: ImportReport };

/**
 * Step 1: parse and validate only. Nothing is written, so cancelling (or just
 * closing the page) leaves the database untouched.
 */
export async function previewImportAction(formData: FormData): Promise<ActionResult<ImportPreview>> {
  return withAdmin(async ({ supabase }) => {
    const files = await readFiles(formData);
    if (typeof files === "string") return fail(files);
    const parsed = parseImportFiles(files);
    const existing = await loadExistingForImport(supabase, parsed);
    return done({ batchId: crypto.randomUUID(), report: forClient(validateImport(parsed, existing)) });
  });
}

const commitSchema = z.object({
  batchId: z.uuid(),
  source: z.string().trim().min(3, "Say where this data came from (at least 3 characters).").max(500),
  notes: z.string().trim().max(1000),
});

export type ImportCommitted = { batchId: string; counts: Record<string, number> };

/**
 * Step 2: the files are validated again against the database as it is now (it
 * may have changed since the preview) and written by one database function, so
 * either everything is imported or nothing is. The batch id makes a double
 * submit harmless.
 */
export async function commitImportAction(formData: FormData): Promise<ActionResult<ImportCommitted> & { report?: ImportReport }> {
  const result = await withAdmin<ImportCommitted & { report?: ImportReport }>(async ({ supabase }) => {
    const meta = commitSchema.safeParse({
      batchId: formData.get("batchId"),
      source: formData.get("source"),
      notes: formData.get("notes") ?? "",
    });
    if (!meta.success) return fail(meta.error.issues[0]?.message ?? "Some values are not valid.");

    const files = await readFiles(formData);
    if (typeof files === "string") return fail(files);
    const parsed = parseImportFiles(files);
    const report = validateImport(parsed, await loadExistingForImport(supabase, parsed));
    if (!report.ok || !report.payload) {
      return { ok: false, error: "The files no longer pass validation, so nothing was imported. Review the report and try again.", report: forClient(report) } as ActionResult<never>;
    }

    const batch = {
      id: meta.data.batchId,
      source_description: meta.data.source,
      notes: meta.data.notes,
      files: IMPORT_KINDS.flatMap((kind) => {
        const file = files[kind];
        const rows = parsed.files[kind]?.rows.length ?? 0;
        return file ? [{ kind, name: file.name, sha256: createHash("sha256").update(file.text).digest("hex"), rows }] : [];
      }),
    };
    const { data, error } = await supabase.rpc("commit_import", { p_payload: { batch, ...report.payload } as unknown as Json });
    if (error) return fail(describeDbError(error));
    const out = data as { batch_id: string; counts: Record<string, number> };
    return done({ batchId: out.batch_id, counts: out.counts });
  });
  return result;
}
