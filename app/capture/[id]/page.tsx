import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSignedDocumentUrl } from "@/lib/documents";
import { formatDate, todayIso } from "@/lib/format";
import type { AssetCategory, Currency } from "@/lib/types";
import { classifyDocument, type AssetCandidate, type Proposal } from "@/lib/classification";
import type { ExtractedStatement } from "@/lib/extraction";
import { ReviewForm, type AssetOption, type Extracted } from "./review-form";

export default async function CaptureLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; extract_error?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam, extract_error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: doc } = await supabase
    .from("documents")
    .select("id, file_name, mime_type, size_bytes, storage_path, uploaded_at, status, extracted_json")
    .eq("id", id)
    .maybeSingle();
  if (!doc) notFound();

  const signedUrl = await getSignedDocumentUrl(supabase, doc.storage_path);

  // Load every asset in the household with its institution name + last4
  // so the review form can pre-select a match and the classifier can
  // make a structured proposal.
  const { data: assetsRaw } = await supabase
    .from("assets")
    .select("id, name, category, native_currency, account_last4, institution_id, institutions(name)")
    .eq("archived", false)
    .order("name", { ascending: true });

  const assets: AssetOption[] = (assetsRaw ?? []).map((a) => {
    const inst = Array.isArray(a.institutions) ? a.institutions[0] : a.institutions;
    return {
      id: a.id,
      name: a.name,
      category: a.category as AssetCategory,
      native_currency: a.native_currency as Currency,
      institution_name: inst?.name ?? null,
    };
  });

  const extracted: Extracted | null =
    doc.status === "extracted" && doc.extracted_json
      ? (doc.extracted_json as Extracted)
      : null;

  // Build the candidate list shape that the classifier expects.
  const candidates: AssetCandidate[] = (assetsRaw ?? []).map((a) => {
    const inst = Array.isArray(a.institutions) ? a.institutions[0] : a.institutions;
    return {
      id: a.id,
      name: a.name,
      category: a.category as AssetCategory,
      native_currency: a.native_currency as Currency,
      account_last4: a.account_last4 ?? null,
      institution_name: inst?.name ?? null,
    };
  });

  const proposal: Proposal | null = extracted
    ? await classifyDocument(extracted as ExtractedStatement, candidates)
    : null;

  const isImage = doc.mime_type.startsWith("image/");
  const isPdf = doc.mime_type === "application/pdf";

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            ← Dashboard
          </Link>
          <h1 className="text-base font-medium tracking-tight">
            {extracted ? "Review and confirm" : "Link to asset"}
          </h1>
          <span className="w-20" />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[1fr_440px]">
        <section>
          <p className="text-xs text-neutral-500">{doc.file_name}</p>
          <p className="mt-1 text-xs text-neutral-400">
            Uploaded {formatDate(doc.uploaded_at.slice(0, 10))} ·{" "}
            {formatBytes(doc.size_bytes)}
            {extracted ? <span className="ml-2 text-green-700 dark:text-green-400">· extracted</span> : null}
          </p>
          <div className="mt-3 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
            {signedUrl ? (
              isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signedUrl} alt={doc.file_name} className="w-full" />
              ) : isPdf ? (
                <iframe
                  src={signedUrl}
                  title={doc.file_name}
                  className="h-[760px] w-full"
                />
              ) : (
                <div className="px-4 py-6 text-sm text-neutral-500">
                  No inline preview for this file type.{" "}
                  <a
                    href={signedUrl}
                    className="underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in a new tab
                  </a>
                </div>
              )
            ) : (
              <div className="px-4 py-6 text-sm text-red-600 dark:text-red-400">
                Could not generate a preview link.
              </div>
            )}
          </div>
        </section>

        <section>
          {extract_error ? (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">Extraction failed — fall back to manual entry.</p>
              <p className="mt-1 text-xs">{decodeURIComponent(extract_error)}</p>
            </div>
          ) : null}

          {errorParam ? (
            <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {decodeURIComponent(errorParam)}
            </div>
          ) : null}

          {extracted ? (
            <p className="mb-4 text-xs text-neutral-500">
              Fields below were extracted by the model. Review every line —
              nothing saves until you tap Confirm.
            </p>
          ) : null}

          {proposal ? <ProposalBanner proposal={proposal} /> : null}

          <ReviewForm
            documentId={doc.id}
            extracted={extracted}
            assets={assets}
            todayIso={todayIso()}
            proposal={proposal}
          />
        </section>
      </main>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ProposalBanner({ proposal }: { proposal: Proposal }) {
  if (proposal.action === "update") {
    return (
      <div className="mb-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
        <p>
          <span className="font-medium">Update “{proposal.asset_name}”</span>
          {proposal.confidence === "high" ? null : (
            <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-green-900 dark:bg-green-900 dark:text-green-100">
              {proposal.confidence}
            </span>
          )}
          {proposal.used_llm ? (
            <span className="ml-2 text-xs text-green-700 dark:text-green-300">
              · resolved by LLM
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs">{proposal.reason}</p>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-md border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
      <p className="font-medium">Create new asset</p>
      <p className="mt-0.5 text-xs">{proposal.reason}</p>
      {proposal.hint ? <p className="mt-1 text-xs italic">{proposal.hint}</p> : null}
    </div>
  );
}
