export default function Loading({ label }: { label: string }) {
  return (
    <main className="page-body">
      <p role="status" className="text-sm text-ink-muted">
        {label}
      </p>
    </main>
  );
}
