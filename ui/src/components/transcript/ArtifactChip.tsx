interface Props {
  path: string;
  active?: boolean;
  onOpen: (path: string) => void;
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

export function ArtifactChip({ path, active, onOpen }: Props) {
  return (
    <button
      type="button"
      className={`tr-artifact-chip${active ? " tr-active" : ""}`}
      onClick={() => onOpen(path)}
      title={`Open ${path}`}
    >
      <span aria-hidden="true">📎</span>
      <span>{basename(path)}</span>
    </button>
  );
}
