export function EmptyState({ title, detail, testId }: { title: string; detail?: string; testId?: string }) {
  return (
    <div className="te-empty-state" data-testid={testId}>
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function LoadingState({ label, testId }: { label: string; testId?: string }) {
  return (
    <div className="te-loading-state" data-testid={testId} aria-live="polite">
      <span className="te-spinner" aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  );
}
