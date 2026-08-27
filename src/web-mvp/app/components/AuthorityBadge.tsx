import { labelAuthority } from "../../domain/authority.js";
import type { AuthorityKind } from "../../domain/types.ts";

export function AuthorityBadge({
  kind,
  testId,
}: {
  kind: AuthorityKind;
  testId?: string;
}) {
  const labeled = labelAuthority(kind);
  return (
    <span
      className={`authority-badge rank-${labeled.rank}`}
      data-authority-kind={labeled.kind}
      data-authority-rank={labeled.rank}
      data-testid={testId}
    >
      <strong>{labeled.label}</strong>
      <span>{labeled.rank}</span>
    </span>
  );
}
