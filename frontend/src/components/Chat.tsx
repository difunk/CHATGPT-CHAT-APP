import React, { useEffect, useState } from "react";

type Message = {
  user_message: string;
  assistant_response: string | null;
};

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("http://localhost:3000/history")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.history)) {
          setMessages(data.history);
        }
      });
  }, []);

  const sendMessage = async () => {
    if (!input.trim()) return;
    setLoading(true);

    setMessages((prev) => [
      ...prev,
      { user_message: input, assistant_response: null },
    ]);

    const response = await fetch("http://localhost:3000/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input }),
    });

    const data = await response.json();

    setMessages((prev) =>
      prev.map((message, index) =>
        index === prev.length - 1
          ? { ...message, assistant_response: data.data }
          : message
      )
    );

    setInput("");
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto" }}>
      <div style={{ border: "1px solid #ccc", padding: 16, minHeight: 300 }}>
        {messages.map((msg, idx) => (
          <div key={idx}>
            <div>
              <b>User:</b> {msg.user_message}
            </div>
            {msg.assistant_response && (
              <div style={{ marginBottom: 12 }}>
                <b>Assistant:</b> {msg.assistant_response}
              </div>
            )}
          </div>
        ))}
        {loading && <div>Assistant schreibt ...</div>}
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "row" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          style={{ width: 400, padding: 12, marginRight: 12 }}
          placeholder="Nachricht eingeben..."
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}>
          Senden
        </button>
      </div>
    </div>
  );
};

export default Chat;
