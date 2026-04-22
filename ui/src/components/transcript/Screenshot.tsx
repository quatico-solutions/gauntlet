import { api } from "../../lib/api";

interface Props {
  runId: string;
  path: string;
  alt?: string;
}

export function Screenshot({ runId, path, alt }: Props) {
  const url = api.results.fileUrl(runId, path);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{ display: "block", lineHeight: 0 }}
      title="Open full size"
    >
      <img className="tr-screenshot" src={url} alt={alt ?? path} />
    </a>
  );
}
