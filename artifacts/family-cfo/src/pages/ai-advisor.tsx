import { useState, useRef, useEffect } from "react";
import { Send, RotateCcw, TrendingUp, HelpCircle, Home, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

const SUGGESTED_QUESTIONS = [
  { icon: Car, text: "Can I afford a $25,000 car?" },
  { icon: TrendingUp, text: "What happens if my income drops 20%?" },
  { icon: Home, text: "How soon can I be mortgage free?" },
  { icon: HelpCircle, text: "How can I increase my savings rate?" },
];

export default function AiAdvisor() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const messageText = text ?? input.trim();
    if (!messageText || isStreaming) return;

    const userMessage: Message = { role: "user", content: messageText };
    const history = messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage, { role: "assistant", content: "", streaming: true }]);
    setInput("");
    setIsStreaming(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageText, conversationHistory: history }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              setMessages((prev) =>
                prev.map((m, i) => i === prev.length - 1 ? { ...m, streaming: false } : m)
              );
              setIsStreaming(false);
              return;
            }
            if (data.content) {
              accumulated += data.content;
              setMessages((prev) =>
                prev.map((m, i) => i === prev.length - 1 ? { ...m, content: accumulated } : m)
              );
            }
          } catch {}
        }
      }

      setMessages((prev) =>
        prev.map((m, i) => i === prev.length - 1 ? { ...m, streaming: false } : m)
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1
            ? { ...m, content: "Sorry, I could not process that request. Please try again.", streaming: false }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full p-6 gap-4 max-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">AI Financial Advisor</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Ask anything about your finances — powered by real transaction data</p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearConversation} className="flex items-center gap-1.5" data-testid="button-clear-chat">
            <RotateCcw className="w-3.5 h-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-12">
            <div className="text-center">
              <p className="text-muted-foreground text-sm">Your personal CFO is ready. Ask anything about your financial situation.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q.text)}
                  className="flex items-center gap-2.5 p-3 bg-card border border-card-border rounded-lg text-left hover:border-primary/40 hover:bg-card/80 transition-colors group"
                  data-testid={`button-suggested-question-${i}`}
                >
                  <q.icon className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="text-sm text-foreground group-hover:text-primary transition-colors">{q.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`message-${msg.role}-${i}`}>
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-card-border text-foreground"
                }`}
              >
                {msg.content || (msg.streaming ? (
                  <span className="inline-flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                ) : "")}
                {msg.streaming && msg.content && (
                  <span className="inline-block w-0.5 h-3.5 bg-current ml-0.5 animate-pulse align-middle" />
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask your CFO anything... (Enter to send, Shift+Enter for newline)"
          className="flex-1 min-h-[48px] max-h-[120px] resize-none text-sm"
          disabled={isStreaming}
          rows={1}
          data-testid="input-chat-message"
        />
        <Button
          onClick={() => sendMessage()}
          disabled={!input.trim() || isStreaming}
          className="h-12 w-12 p-0 flex-shrink-0"
          data-testid="button-send-message"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
