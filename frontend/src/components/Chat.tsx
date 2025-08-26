import React, { useEffect, useState } from "react";

type Message = {
  user_message: string;
  assistant_response: string | null;
};

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamedText, setStreamedText] = useState("");

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

  const sendStreamMessage = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setStreamedText("");

    setMessages((prev) => [
      ...prev,
      { user_message: input, assistant_response: null },
    ]);

    const response = await fetch("http://localhost:3000/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const jsonStr = line.substring(6);
              if (jsonStr.trim() && jsonStr !== "[DONE]") {
                const data = JSON.parse(jsonStr);
                if (data.content) {
                  fullText += data.content;
                  setStreamedText(fullText);
                }
              }
            } catch (e) {
              console.warn("Konnte JSON nicht parsen:", line, e);
            }
          }
        }
      }
    }

    setMessages((prev) =>
      prev.map((msg, idx) =>
        idx === prev.length - 1 ? { ...msg, assistant_response: fullText } : msg
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
            {idx === messages.length - 1 && loading ? (
              <div style={{ marginBottom: 12 }}>
                <b>Assistant:</b> {streamedText}
              </div>
            ) : (
              msg.assistant_response && (
                <div style={{ marginBottom: 12 }}>
                  <b>Assistant:</b> {msg.assistant_response}
                </div>
              )
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "row" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendStreamMessage()}
          style={{ width: 400, padding: 12, marginRight: 12 }}
          placeholder="Nachricht eingeben..."
        />
        <button onClick={sendStreamMessage} disabled={loading || !input.trim()}>
          Senden
        </button>
      </div>
    </div>
  );
};

export default Chat;
