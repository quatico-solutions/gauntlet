interface Props {
  content: string;
}

export function UserMessagePanel({ content }: Props) {
  return (
    <div className="tr-user-message">
      <div className="tr-user-message-label">User</div>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{content}</p>
    </div>
  );
}
