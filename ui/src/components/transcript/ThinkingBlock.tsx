interface Props {
  text: string;
}

export function ThinkingBlock({ text }: Props) {
  if (!text.trim()) return null;
  return (
    <div className="tr-thinking">
      <div className="tr-thinking-label">thinking</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
    </div>
  );
}
