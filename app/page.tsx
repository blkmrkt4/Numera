import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-medium tracking-tight">Numara</h1>
        <p className="mt-3 text-sm text-neutral-500">
          A personal net worth tracker built around document capture.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block rounded-md bg-neutral-900 px-5 py-2.5 text-sm text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
