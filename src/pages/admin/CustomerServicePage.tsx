import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useProducts } from "@/lib/products-context-hooks";
import { Send, Volume2, VolumeX, Headset, Circle, ImagePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadChatImage, encodeImageAttachment, parseImageAttachment } from "@/lib/chat-image-upload";
import { toast } from "sonner";
import { playNotificationSound, startTabFlash } from "@/hooks/use-notifications";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { useAdminAccess } from "@/hooks/use-admin-access";

interface Session {
  id: string;
  reseller_id?: string;
  customer_name: string;
  customer_avatar?: string;
  is_online: boolean;
  last_message_at: string;
}

interface Message {
  id: string;
  session_id: string;
  sender: string;
  message: string;
  attachment_product_id: string | null;
  is_read: boolean;
  created_at: string;
}

export default function CustomerServicePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);

  const resellers = useUnifiedResellers();
  const { canSeeAll, hasAccessToReseller } = useAdminAccess();

  const filteredSessions = useMemo(() => {
    if (canSeeAll) return sessions;
    return sessions.filter(session => {
      if (!session.reseller_id) return true; // Let staff see prospect chats
      const reseller = resellers.find(r => r.id === session.reseller_id);
      if (!reseller) return false;
      return hasAccessToReseller({
        referredBy: reseller.referredBy,
        memberOfAdminId: reseller.memberOfAdminId
      });
    });
  }, [sessions, resellers, canSeeAll, hasAccessToReseller]);

  // Ensure active session is cleared if it's no longer allowed
  useEffect(() => {
    if (activeSessionId && filteredSessions.length > 0) {
      const exists = filteredSessions.some(s => s.id === activeSessionId);
      if (!exists) {
        setActiveSessionId(null);
      }
    }
  }, [activeSessionId, filteredSessions]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { products } = useProducts();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Realtime subscriptions for sessions
  useEffect(() => {
    const fetchSessions = async () => {
      const { data } = await supabase
        .from('support_sessions')
        .select('*')
        .order('last_message_at', { ascending: false })
        .limit(50);
      if (data) setSessions(data);
    };
    fetchSessions();

    const channel = supabase
      .channel('support_sessions_admin')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'support_sessions' 
      }, () => {
        fetchSessions();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Realtime subscriptions for messages
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('support_messages')
        .select('*')
        .eq('session_id', activeSessionId)
        .order('created_at', { ascending: true })
        .limit(10); // user requested limit to 5, we'll fetch few more for safety
      
      if (data) {
        // Enforce 5 message limit if needed, but let's see what user said exactly
        // "set up to see only the last 5 messages for every chat sessions"
        const mapped = data.map((m: { id: string; session_id: string; sender: string; is_read: boolean; created_at: string; content?: string | null; message?: string | null }) => ({
          ...m,
          message: m.content || m.message || ""
        }));
        const limited = mapped.slice(-5);
        setMessages(limited);
      }
    };
    fetchMessages();

    const channel = supabase
      .channel(`support_messages_${activeSessionId}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'support_messages',
        filter: `session_id=eq.${activeSessionId}`
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newMsg = payload.new as Message;
          if (newMsg.sender === "customer" && !newMsg.is_read) {
            if (soundEnabled) playNotificationSound();
            if (document.hidden) startTabFlash();
          }
        }
        fetchMessages();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSessionId, soundEnabled]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Mark messages read when viewing
  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    const unread = messages.filter((m) => m.sender === "customer" && !m.is_read);
    if (unread.length > 0) {
      const markAsRead = async () => {
        for (const msg of unread) {
          await supabase.from('support_messages').update({ is_read: true }).eq('id', msg.id);
        }
      };
      markAsRead().catch(console.error);
    }
  }, [activeSessionId, messages]);

  const handleSend = async () => {
    if (!input.trim() || !activeSessionId) return;
    const msg = input.trim();
    setInput("");
    
    try {
      const res = await fetch('/api/send-support-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSessionId,
          sender: "support",
          content: msg
        })
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error(String(error));
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSessionId) return;
    
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setUploading(true);
    try {
      const url = await uploadChatImage(file);
      if (url) {
        await fetch('/api/send-support-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: activeSessionId,
            sender: "support",
            content: encodeImageAttachment(url, input.trim())
          })
        });
        
        setInput("");
        toast.success("Image sent");
      }
    } catch (error) {
      console.error("Image upload error:", error);
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await supabase.from('support_messages').delete().eq('id', messageId);
      toast.success("Message deleted");
    } catch (error) {
      console.error("Error deleting message:", error);
      toast.error("Failed to delete message");
    }
  };

  const attachProduct = async (productId: string, productName: string) => {
    if (!activeSessionId) return;
    
    try {
      await fetch('/api/send-support-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSessionId,
          sender: "support",
          content: `📦 Product: ${productName}`
        })
      });
    } catch (error) {
      console.error("Error attaching product:", error);
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Find product info for attached products
  const getProduct = (id: string | null) => {
    if (!id) return null;
    return products.find((p) => p.id === id) ?? null;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Headset className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Customer Service</h1>
          <span className="text-xs text-muted-foreground ml-2">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="p-2 rounded-lg hover:bg-accent transition-colors"
          title={soundEnabled ? "Mute notifications" : "Unmute notifications"}
        >
          {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Sessions list */}
        <div className="w-64 border-r border-border overflow-y-auto flex-shrink-0 bg-card">
          <div className="p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 tracking-wider">
              Recent Sessions
            </p>
          </div>
          {filteredSessions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No sessions found
            </div>
          ) : (
            filteredSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50",
                  activeSessionId === s.id && "bg-primary/10 border-r-2 border-primary"
                )}
              >
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                    {s.customer_name.charAt(0).toUpperCase()}
                  </div>
                  <Circle className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-3 w-3",
                    s.is_online ? "fill-green-500 text-green-500" : "fill-muted text-muted-foreground"
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.customer_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(s.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Center: Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {!activeSessionId ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Headset className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a customer session to start chatting</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                  {activeSession?.customer_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{activeSession?.customer_name}</p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Circle className={cn(
                      "h-2 w-2",
                      activeSession?.is_online ? "fill-green-500 text-green-500" : "fill-muted text-muted-foreground"
                    )} /> {activeSession?.is_online ? "Online" : "Offline"}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m) => {
                  const attached = getProduct(m.attachment_product_id);
                  const { text: imgText, imageUrl } = parseImageAttachment(m.message);
                  
                  return (
                    <div key={m.id} className={`flex ${m.sender === "support" ? "flex-row-reverse" : "flex-row"} items-center gap-2 group`}>
                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-3 py-2 text-sm relative",
                          m.sender === "support"
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted text-foreground rounded-bl-md"
                        )}
                      >
                        {imgText && <p className="leading-relaxed">{imgText}</p>}
                        {!imgText && !imageUrl && <p className="leading-relaxed">{m.message}</p>}
                        
                        {imageUrl && (
                          <img 
                            src={imageUrl} 
                            alt="attachment" 
                            className="w-48 h-auto mt-2 rounded-lg object-contain border cursor-pointer"
                            onClick={() => window.open(imageUrl, "_blank")}
                          />
                        )}
                        {attached && (
                          <div className="mt-2 p-2 rounded-lg bg-background/20 flex items-center gap-2">
                            <img
                              src={attached.image || "/placeholder.svg"}
                              alt={attached.name}
                              className="w-10 h-10 rounded object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).src = "/placeholder.svg"; }}
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{attached.name}</p>
                              <p className="text-[10px] opacity-70">${attached.price}</p>
                            </div>
                          </div>
                        )}
                        <p
                          className={cn(
                            "text-[9px] mt-1",
                            m.sender === "support" ? "text-primary-foreground/60" : "text-muted-foreground/60"
                          )}
                        >
                          {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteMessage(m.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete message"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Input */}
              <div className="px-3 py-3 border-t border-border">
                <div className="flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={uploading}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="p-1.5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
                    title="Attach image"
                  >
                    <ImagePlus className="h-5 w-5" />
                  </button>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    placeholder={uploading ? "Uploading..." : "Type a message..."}
                    className="flex-1 bg-transparent text-sm py-1.5 focus:outline-none placeholder:text-muted-foreground"
                    disabled={uploading}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() && !uploading}
                    className="p-1.5 rounded-full bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: Product cards */}
        {activeSessionId && (
          <div className="w-56 border-l border-border overflow-y-auto flex-shrink-0 bg-card hidden lg:block">
            <div className="p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 tracking-wider">
                Attach Product
              </p>
            </div>
            <div className="px-2 space-y-2 pb-4">
              {products.slice(0, 20).map((p) => (
                <button
                  key={p.id}
                  onClick={() => attachProduct(p.id, p.name)}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 transition-colors text-left"
                >
                  <img
                    src={p.image || "/placeholder.svg"}
                    alt={p.name}
                    className="w-10 h-10 rounded object-cover flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).src = "/placeholder.svg"; }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground">${p.price}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
