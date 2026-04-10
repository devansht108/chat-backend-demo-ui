"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import axios from "axios";

type User = { _id: string; username: string };

type Message = {
  _id: string;
  content: string;
  sender: string;
  conversationId: string;
  status?: "sent" | "delivered" | "read";
  fromMe?: boolean;
  isTemp?: boolean;
  clientId?: string;
};

type Conversation = {
  conversationId: string;
  participants: User[];
  online: boolean;
  lastSeen: number | null;
};

type AnalysisResult = {
  score: number;
  keyMoments: string[];
  coachingTip: string;
  analyzedAt: string;
};

export default function ChatPage() {
  const socketRef = useRef<Socket | null>(null);
  const activeConvRef = useRef<Conversation | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const myId: string | null = token
    ? JSON.parse(atob(token.split(".")[1])).userId
    : null;

  const API = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL,
    headers: { Authorization: `Bearer ${token}` },
  });

  const getOtherUserId = (conv: Conversation) =>
    conv.participants.find((p) => p._id !== myId)!._id;

  useEffect(() => {
    if (!token) return;

    API.get("/api/conversations/list").then((res) => {
      const convs: Conversation[] = res.data.conversations;
      setConversations(convs);
      if (convs.length > 0) openConversation(convs[0]);
    });
  }, [token]);

  useEffect(() => {
    activeConvRef.current = activeConv;
  }, [activeConv]);

  useEffect(() => {
    if (!token) return;

    const socket: Socket = io(process.env.NEXT_PUBLIC_API_URL!, {
      auth: { token },
      transports: ["websocket"],
    });

    socketRef.current = socket;
    // @ts-ignore
    window.chatSocket = socket;

    socket.on("receive_message", (msg: Message) => {
      const convId = msg.conversationId;
      if (!convId) return;

      setMessages((prev) => {
        const list = prev[convId] || [];
        let replaced = false;

        const updated = list.map((m) => {
          if (m.isTemp && m.clientId && msg.clientId === m.clientId) {
            replaced = true;
            let newStatus: Message["status"] = "delivered";
            if (m.status === "read") newStatus = "read";
            return { ...msg, fromMe: true, status: newStatus };
          }
          return m;
        });

        if (!replaced) {
          updated.push({ ...msg, fromMe: msg.sender === myId });
        }

        return { ...prev, [convId]: updated };
      });

      if (
        msg.sender !== myId &&
        activeConvRef.current?.conversationId === convId
      ) {
        socket.emit("message_read", { messageId: msg._id });
      }
    });

    socket.on("message_delivered", ({ messageId }: { messageId: string }) => {
      setMessages((prev) => {
        const copy: typeof prev = {};
        for (const convId in prev) {
          copy[convId] = prev[convId].map((m) =>
            m.fromMe && String(m._id) === String(messageId)
              ? { ...m, status: "delivered" }
              : m,
          );
        }
        return copy;
      });
    });

    socket.on("message_read", ({ messageId }: { messageId: string }) => {
      setMessages((prev) => {
        const copy: typeof prev = {};
        for (const convId in prev) {
          copy[convId] = prev[convId].map((m) =>
            m.fromMe && String(m._id) === String(messageId)
              ? { ...m, status: "read" }
              : m,
          );
        }
        return copy;
      });
    });

    socket.on("typing", ({ userId }: { userId: string }) => {
      const active = activeConvRef.current;
      if (active && userId === getOtherUserId(active)) setTypingUser(userId);
    });

    socket.on("stop_typing", ({ userId }: { userId: string }) => {
      const active = activeConvRef.current;
      if (active && userId === getOtherUserId(active)) setTypingUser(null);
    });

    socket.on("user_online", ({ userId }: { userId: string }) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.participants.some((p) => p._id === userId)
            ? { ...c, online: true }
            : c,
        ),
      );
    });

    socket.on("user_offline", ({ userId }: { userId: string }) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.participants.some((p) => p._id === userId)
            ? { ...c, online: false, lastSeen: Date.now() }
            : c,
        ),
      );
    });

    // AI analysis result socket event
    socket.on(
      "conversation_analysis",
      (data: { analysis: AnalysisResult; analyzedAt: string }) => {
        setAnalysis({ ...data.analysis, analyzedAt: data.analyzedAt });
        setAnalyzing(false);
      },
    );

    return () => {
      socket.disconnect();
    };
  }, [token]);

  const openConversation = async (conv: Conversation) => {
    setActiveConv(conv);
    setAnalysis(null); // clear old analysis on conv switch
    const res = await API.get(
      `/api/conversations/${conv.conversationId}/messages`,
    );

    const mapped: Message[] = res.data.messages.map((m: Message) => ({
      ...m,
      fromMe: m.sender === myId,
    }));

    setMessages((prev) => ({ ...prev, [conv.conversationId]: mapped }));

    mapped.forEach((m) => {
      if (!m.fromMe && m.status !== "read") {
        socketRef.current?.emit("message_read", { messageId: m._id });
      }
    });
  };

  const sendMessage = () => {
    if (!socketRef.current || !activeConv || !input.trim() || !myId) return;

    const clientId = "client-" + Date.now();

    const tempMsg: Message = {
      _id: clientId,
      content: input,
      sender: myId,
      conversationId: activeConv.conversationId,
      status: "sent",
      fromMe: true,
      isTemp: true,
      clientId,
    };

    setMessages((prev) => ({
      ...prev,
      [activeConv.conversationId]: [
        ...(prev[activeConv.conversationId] || []),
        tempMsg,
      ],
    }));

    socketRef.current.emit("send_message", {
      receiverId: getOtherUserId(activeConv),
      content: input,
      clientId,
    });

    setInput("");
  };

  const handleTyping = (val: string) => {
    setInput(val);
    if (!socketRef.current || !activeConv) return;

    socketRef.current.emit("typing", {
      receiverId: getOtherUserId(activeConv),
    });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("stop_typing", {
        receiverId: getOtherUserId(activeConv),
      });
    }, 1200);
  };

  const analyzeConversation = async () => {
    if (!activeConv) return;
    setAnalyzing(true);
    setAnalysis(null);
    await API.post(`/api/conversations/${activeConv.conversationId}/analyze`);
    // result will arrive via socket event "conversation_analysis"
  };

  const formatLastSeen = (timestamp: number | null) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const scoreColor = (score: number) => {
    if (score >= 7) return "#22c55e";
    if (score >= 4) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div className="flex h-screen">
      {/* LEFT PANEL */}
      <div className="w-72 border-r p-3 bg-white space-y-4">
        <div className="p-3 rounded bg-blue-50 border text-xs text-gray-700">
          <div className="font-semibold mb-1">Basic Instructions</div>
          <ul className="list-disc ml-4 space-y-1">
            <li>-Open two accounts in two browsers to test real-time chat</li>
            <li>-Typing indicator works live</li>
            <li>-Online / Offline status updates live</li>
            <li>-Last seen updates on inactivity or logout</li>
            <li>-Read receipt status works live</li>
          </ul>
        </div>

        <h2 className="font-bold mb-3">Chats</h2>

        {conversations.map((c) => {
          const other = c.participants.find((p) => p._id !== myId);
          return (
            <div
              key={c.conversationId}
              className="p-2 flex flex-col cursor-pointer hover:bg-gray-50 rounded"
              onClick={() => openConversation(c)}
            >
              <div className="flex justify-between">
                {other?.username}
                <span>{c.online ? "🟢" : "⚫"}</span>
              </div>
              {!c.online && c.lastSeen && (
                <div className="text-xs text-gray-500">
                  Last seen: {formatLastSeen(c.lastSeen)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 flex flex-col">
        {/* HEADER */}
        <div className="p-4 border-b bg-white font-semibold flex justify-between items-center">
          <div>
            {activeConv?.participants.find((p) => p._id !== myId)?.username}
            {typingUser && (
              <div className="text-xs text-blue-600 font-semibold">
                Typing...
              </div>
            )}
          </div>

          {/* ANALYZE BUTTON */}
          {activeConv && (
            <button
              onClick={analyzeConversation}
              disabled={analyzing}
              className="text-sm px-3 py-1 rounded"
              style={{
                background: analyzing ? "#94a3b8" : "#6366f1",
                color: "white",
                cursor: analyzing ? "not-allowed" : "pointer",
              }}
            >
              {analyzing ? "Analyzing..." : "🤖 Analyze Conversation"}
            </button>
          )}
        </div>

        {/* ANALYSIS CARD */}
        {analysis && (
          <div
            style={{
              margin: "12px 16px",
              padding: "16px",
              borderRadius: "12px",
              background: "#0f172a",
              color: "white",
              border: "1px solid #334155",
            }}
          >
            <div
              style={{
                fontSize: "13px",
                color: "#94a3b8",
                marginBottom: "10px",
              }}
            >
              🤖 AI Coaching Analysis
            </div>

            {/* SCORE */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <div
                style={{
                  fontSize: "36px",
                  fontWeight: "bold",
                  color: scoreColor(analysis.score),
                }}
              >
                {analysis.score}/10
              </div>
              <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                Communication Score
              </div>
            </div>

            {/* KEY MOMENTS */}
            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "4px" }}>
                📌 Key Moments
              </div>
              {analysis.keyMoments.map((km, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: "13px",
                    padding: "6px 10px",
                    background: "#1e293b",
                    borderRadius: "6px",
                    marginBottom: "4px",
                  }}
                >
                  {km}
                </div>
              ))}
            </div>

            {/* COACHING TIP */}
            <div
              style={{
                padding: "10px",
                background: "#1e3a5f",
                borderRadius: "8px",
                fontSize: "13px",
                borderLeft: "3px solid #3b82f6",
              }}
            >
              <span style={{ color: "#60a5fa", fontWeight: "bold" }}>
                💡 Coaching Tip:{" "}
              </span>
              {analysis.coachingTip}
            </div>
          </div>
        )}

        {/* MESSAGES */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {activeConv &&
            messages[activeConv.conversationId]?.map((m) => (
              <div
                key={m._id}
                className={`max-w-xs p-2 rounded ${
                  m.fromMe
                    ? "bg-blue-500 text-white ml-auto"
                    : "bg-white border"
                }`}
              >
                {m.content}
                {m.fromMe && (
                  <div className="text-xs text-right mt-1">
                    {m.status === "read"
                      ? "✓✓ (Read)"
                      : m.status === "delivered"
                        ? "✓✓"
                        : "✓"}
                  </div>
                )}
              </div>
            ))}
        </div>

        {/* INPUT */}
        <div className="p-4 bg-white flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2"
            value={input}
            onChange={(e) => handleTyping(e.target.value)}
            placeholder="Type a message..."
          />
          <button
            onClick={sendMessage}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}