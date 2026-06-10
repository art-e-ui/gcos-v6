import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Search, Pin, PinOff, Volume2, VolumeX, Send, MessageSquare, Circle, Users, ShoppingBag, ImagePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useProducts } from "@/lib/products-context-hooks";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { parseImageAttachment, uploadChatImage, encodeImageAttachment } from "@/lib/chat-image-upload";
import { toast } from "sonner";
import { useAdminAccess } from "@/hooks/use-admin-access";

interface ChatSession {
  id: string;
  reseller_id: string;
  reseller_name: string;
  reseller_avatar?: string;
  is_online: boolean;
  is_pinned: boolean;
  last_message_at: string;
  last_message?: string;
  unread_count?: number;
  formattedId?: string;
  // UI Helpers
  lastMessage?: string;
  unreadCount?: number;
}

interface ChatMessage {
  id: string;
  session_id: string;
  sender: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

import { playNotificationSound, startTabFlash } from "@/hooks/use-notifications";

function ProductAttachmentCard({ product }: { product: { id: string; name: string; price: number; image: string } }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2 mt-1 max-w-[260px]">
      <img
        src={product.image || "/placeholder.svg"}
        alt={product.name}
        className="w-12 h-12 rounded-md object-cover flex-shrink-0 bg-muted"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground truncate">{product.name}</p>
        <p className="text-[10px] text-muted-foreground">ID: {product.id.slice(0, 8)}</p>
        <p className="text-xs font-bold text-primary">${product.price.toFixed(2)}</p>
      </div>
    </div>
  );
}

function parseAttachment(message: string): { text: string; product: { id: string; name: string; price: number; image: string } | null } {
  const tag = "[PRODUCT_ATTACH:";
  const idx = message.indexOf(tag);
  if (idx === -1) return { text: message, product: null };
  try {
    const jsonStart = idx + tag.length;
    const jsonEnd = message.indexOf("]", jsonStart);
    const json = message.substring(jsonStart, jsonEnd);
    const product = JSON.parse(json);
    const text = message.substring(0, idx).trim();
    return { text, product };
  } catch {
    return { text: message, product: null };
  }
}

export default function Reseller2AdminPage() {
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [productSearch, setProductSearch] = useState("");
  const [rightSheetOpen, setRightSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { products } = useProducts();
  const rawResellers = useUnifiedResellers();
  const { canSeeAll, hasAccessToReseller } = useAdminAccess();

  const allResellers = useMemo(() => {
    if (canSeeAll) return rawResellers;
    return rawResellers.filter(r => hasAccessToReseller(r));
  }, [rawResellers, canSeeAll, hasAccessToReseller]);

  // Combine all resellers with existing chat sessions
  const displaySessions = useMemo(() => {
    const sessionsFromResellers = allResellers.map(reseller => {
      const relevantSessions = chatSessions.filter(s => s.reseller_id === reseller.id);
      const session = relevantSessions[0]; // Most recent for last message/unread
      const isOnline = relevantSessions.some(s => s.is_online === true);
      const formattedId = reseller.resellerId ? `GRS-${reseller.resellerId}` : reseller.id;
      
      if (session) return { ...session, is_online: isOnline, formattedId };
      
      return {
        id: `temp-${reseller.id}`,
        reseller_id: reseller.id,
        reseller_name: (reseller as Reseller).shopName || reseller.name,
        reseller_avatar: "",
        is_online: false,
        is_pinned: false,
        last_message_at: new Date(0).toISOString(),
        lastMessage: "No messages yet",
        unreadCount: 0,
        formattedId
      } as ChatSession;
    });

    const resellerIds = new Set(allResellers.map(r => r.id));
    const orphanedSessions = chatSessions
      .filter(s => !resellerIds.has(s.reseller_id))
      .map(s => ({ ...s, formattedId: s.reseller_id }));

    if (!canSeeAll) {
      return sessionsFromResellers;
    }
    return [...sessionsFromResellers, ...orphanedSessions];
  }, [allResellers, chatSessions, canSeeAll]);

  const onlineResellers = displaySessions.filter((s) => s.is_online);
  const offlineResellers = displaySessions.filter((s) => !s.is_online);

  const filteredProducts = products.filter((p) => {
    if (!productSearch) return true;
    const q = productSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
  });

  // Fetch initial sessions and subscribe
  useEffect(() => {
    const fetchSessions = async () => {
      const { data, error } = await supabase
        .from("reseller_chat_sessions")
        .select("*")
        .is("customer_id", null)
        .order("last_message_at", { ascending: false })
        .limit(50);
      
      if (error) {
        console.error("Error fetching sessions:", error);
        return;
      }
      
      setChatSessions(data.map(s => ({
        ...s,
        is_pinned: s.is_pinned ?? false,
        lastMessage: s.last_message || "",
        unreadCount: s.unread_count || 0
      })));
    };

    fetchSessions();

    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const channel = supabase.channel(`reseller_sessions_all_${randomSuffix}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'reseller_chat_sessions'
      }, () => {
        fetchSessions();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch / Subscribe to messages
  useEffect(() => {
    if (!activeSessionId || activeSessionId.startsWith('temp-')) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from("reseller_chat_messages")
        .select("*")
        .eq("session_id", activeSessionId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Error fetching messages:", error);
        return;
      }

      const mapped = (data || []).map((m: { id: string; session_id: string; sender: string; is_read: boolean; created_at: string; content?: string | null; message?: string | null }) => ({
        ...m,
        message: m.content || m.message || ""
      }));

      const sortedMessages = [...mapped].sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      setMessages(prev => {
        const prevIds = new Set(prev.map(m => m.id));
        const newResellerMsgs = sortedMessages.filter(m => !prevIds.has(m.id) && m.sender === "reseller");
        
        if (newResellerMsgs.length > 0) {
          if (soundEnabled) playNotificationSound();
          if (document.hidden) startTabFlash();
        }
        return sortedMessages;
      });

      // Mark as read
      const unread = data.filter(m => m.sender === "reseller" && !m.is_read);
      if (unread.length > 0) {
        await supabase
          .from("reseller_chat_messages")
          .update({ is_read: true })
          .in("id", unread.map(m => m.id));
        
        // Decrement unread count on session
        const { data: sessionData } = await supabase
          .from("reseller_chat_sessions")
          .select("unread_count")
          .eq("id", activeSessionId)
          .single();
        
        if (sessionData) {
          const newCount = Math.max(0, (sessionData.unread_count || 0) - unread.length);
          await supabase
            .from("reseller_chat_sessions")
            .update({ unread_count: newCount })
            .eq("id", activeSessionId);
        }
      }
    };

    fetchMessages();

    const randomSuffixMsgs = Math.random().toString(36).substring(2, 9);
    const channel = supabase.channel(`messages-${activeSessionId}_${randomSuffixMsgs}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'reseller_chat_messages',
        filter: `session_id=eq.${activeSessionId}`
      }, () => {
        fetchMessages();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSessionId, soundEnabled]);

  const selectSession = useCallback(async (sessionId: string) => {
    if (sessionId.startsWith("temp-")) {
      const resellerId = sessionId.replace("temp-", "");
      const reseller = allResellers.find(r => r.id === resellerId);
      if (!reseller) return;

      try {
        const { data: existingSession, error: fetchError } = await supabase
          .from("reseller_chat_sessions")
          .select("id")
          .eq("reseller_id", resellerId)
          .is("customer_id", null)
          .maybeSingle();
        
        if (existingSession) {
          setActiveSessionId(existingSession.id);
        } else {
          const { data: newSession, error: createError } = await supabase
            .from("reseller_chat_sessions")
            .insert({
              reseller_id: reseller.id,
              reseller_name: (reseller as Reseller).shopName || reseller.name,
              is_online: false,
              is_pinned: false,
              last_message_at: new Date().toISOString(),
              unread_count: 0
            })
            .select()
            .single();
          
          if (newSession) setActiveSessionId(newSession.id);
        }
      } catch (error) {
        console.error("Error starting session:", error);
      }
    } else {
      setActiveSessionId(sessionId);
    }
  }, [allResellers]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  useEffect(() => {
    if (activeSessionId && !activeSessionId.startsWith('temp-')) {
      supabase
        .from("reseller_chat_sessions")
        .update({ unread_count: 0 })
        .eq("id", activeSessionId)
        .then(({ error }) => {
          if (error) console.error("Error clearing unread count:", error);
        });
    }
  }, [activeSessionId]);

  const handleSend = async (extraText?: string) => {
    const text = extraText ?? input.trim();
    if (!text || !activeSessionId || activeSessionId.startsWith('temp-')) return;
    if (!extraText) setInput("");
    
    try {
      const res = await fetch('/api/send-reseller-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSessionId,
          sender: "admin",
          content: text
        })
      });
      
      if (!res.ok) {
        throw new Error(`Failed to send message: ${await res.text()}`);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message");
    }
  };

  const attachProduct = (product: { id: string; name: string; price: number; image: string }) => {
    const payload = JSON.stringify({ id: product.id, name: product.name, price: product.price, image: product.image });
    const msg = `[PRODUCT_ATTACH:${payload}]`;
    handleSend(msg);
    setRightSheetOpen(false);
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
        const msgText = input.trim();
        await handleSend(encodeImageAttachment(url, msgText));
        setInput("");
        toast.success("Image attached");
      } else {
        toast.error("Failed to upload image");
      }
    } catch (error) {
      console.error("Image upload error:", error);
      toast.error("An error occurred during upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      const { error } = await supabase.from("reseller_chat_messages").delete().eq("id", messageId);
      if (error) throw error;
      toast.success("Message deleted");
    } catch (error) {
      console.error("Error deleting message:", error);
      toast.error("Failed to delete message");
    }
  };

  const togglePin = async (sessionId: string, currentPinned: boolean) => {
    try {
      const { error } = await supabase
        .from("reseller_chat_sessions")
        .update({ is_pinned: !currentPinned })
        .eq("id", sessionId);
      if (error) throw error;
    } catch (error) {
      console.error("Error toggling pin:", error);
    }
  };

  const filtered = displaySessions
    .filter((s) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return s.reseller_name.toLowerCase().includes(q) || 
             s.reseller_id.toLowerCase().includes(q) ||
             (s.formattedId && s.formattedId.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });

  const activeSession = displaySessions.find((s) => s.id === activeSessionId);
  const activeReseller = useMemo(() => {
    if (!activeSession) return null;
    return allResellers.find(r => r.id === activeSession.reseller_id);
  }, [activeSession, allResellers]);

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Reseller 2 Admin</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">
            <Circle className="inline h-2 w-2 fill-emerald-500 text-emerald-500 mr-1" />
            {onlineResellers.length} online
          </span>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title={soundEnabled ? "Mute" : "Unmute"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* RIGHT edge button – Products */}
        <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                "absolute right-0 top-1/2 -translate-y-1/2 z-30 bg-primary text-primary-foreground rounded-l-lg px-1.5 py-3 shadow-lg hover:bg-primary/90 transition-colors",
                !activeSessionId && "opacity-40 pointer-events-none"
              )}
              title="Product Catalog"
              disabled={!activeSessionId}
            >
              <ShoppingBag className="h-4 w-4" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 sm:max-w-sm p-0 flex flex-col">
            <SheetHeader className="p-4 border-b border-border">
              <SheetTitle className="text-base">Attach Product</SheetTitle>
            </SheetHeader>
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products..."
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              {filteredProducts.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-12">No products found</p>
              )}
              <div className="grid grid-cols-2 gap-2 p-3">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => attachProduct(p)}
                    className="flex flex-col items-center rounded-lg border border-border bg-card p-2 hover:bg-accent/50 hover:border-primary/40 transition-colors text-left group"
                  >
                    <img
                      src={p.image || "/placeholder.svg"}
                      alt={p.name}
                      className="w-full aspect-square rounded-md object-cover bg-muted mb-1.5"
                    />
                    <p className="text-[11px] font-semibold text-foreground w-full truncate">{p.name}</p>
                    <p className="text-[9px] text-muted-foreground w-full truncate">ID: {p.id.slice(0, 8)}</p>
                    <p className="text-xs font-bold text-primary w-full">${p.price.toFixed(2)}</p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* Sessions list with online/offline sections */}
        <div className={cn(
          "w-full md:w-80 lg:w-96 border-r border-border flex flex-col flex-shrink-0",
          activeSessionId && "hidden md:flex"
        )}>
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search resellers..."
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>

          {/* Online / Offline status summary */}
          <div className="px-4 py-2 border-b border-border flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <Circle className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500" />
              <span className="font-semibold text-foreground">{onlineResellers.length}</span>
              <span className="text-muted-foreground">Online</span>
            </span>
            <span className="flex items-center gap-1">
              <Circle className="h-2.5 w-2.5 fill-muted text-muted-foreground" />
              <span className="font-semibold text-foreground">{offlineResellers.length}</span>
              <span className="text-muted-foreground">Offline</span>
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-12">No conversations yet</p>
            )}
            {filtered.map((s) => (
              <div
                key={s.id}
                onClick={() => selectSession(s.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border/50 hover:bg-accent/50 transition-colors",
                  s.id === activeSessionId && "bg-accent",
                  s.is_pinned && "bg-primary/5"
                )}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {s.reseller_name.charAt(0)}
                  </div>
                  <Circle className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5",
                    s.is_online ? "fill-emerald-500 text-emerald-500" : "fill-muted text-muted-foreground"
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-foreground truncate">{s.reseller_name}</span>
                      <span className="text-[10px] text-muted-foreground">{s.formattedId}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {new Date(s.last_message_at).getTime() > 0 
                        ? new Date(s.last_message_at).toLocaleDateString([], { month: "short", day: "numeric" })
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">{s.lastMessage || "No messages yet"}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {s.is_pinned && <Pin className="h-3 w-3 text-primary" />}
                      {(s.unreadCount ?? 0) > 0 && (
                        <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                          {s.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium",
                    s.is_online ? "text-emerald-600" : "text-muted-foreground"
                  )}>
                    {s.is_online ? "Online" : "Offline"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat panel */}
        <div className={cn(
          "flex-1 flex flex-col",
          !activeSessionId && "hidden md:flex"
        )}>
          {!activeSessionId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p className="text-lg font-medium">Select a conversation</p>
                <p className="text-sm mt-1">Choose a reseller from the list to start chatting</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveSessionId(null)}
                    className="md:hidden p-1 rounded hover:bg-accent mr-1 text-sm"
                  >
                    ←
                  </button>
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                      {activeSession?.reseller_name.charAt(0) ?? "R"}
                    </div>
                    <Circle className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5",
                      activeSession?.is_online ? "fill-emerald-500 text-emerald-500" : "fill-muted text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{activeSession?.reseller_name}</p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      ID: {activeReseller?.resellerId ? `GRS-${activeReseller.resellerId}` : activeSession?.reseller_id}
                      <span className={cn(
                        "ml-1 font-medium",
                        activeSession?.is_online ? "text-emerald-600" : ""
                      )}>
                        · {activeSession?.is_online ? "Online" : "Offline"}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => activeSession && togglePin(activeSession.id, activeSession.is_pinned)}
                  className={cn(
                    "p-2 rounded-lg hover:bg-accent transition-colors",
                    activeSession?.is_pinned && "text-primary"
                  )}
                  title={activeSession?.is_pinned ? "Unpin" : "Pin"}
                >
                  {activeSession?.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-12">
                    <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p>Start a conversation</p>
                  </div>
                )}
                {messages.map((m) => {
                  const { text: productText, product } = parseAttachment(m.message);
                  const { text: imgText, imageUrl } = parseImageAttachment(product ? productText : m.message);
                  const displayText = product ? productText : imgText;

                  return (
                    <div key={m.id} className={`flex ${m.sender === "admin" ? "flex-row-reverse" : "flex-row"} items-center gap-2 group`}>
                      <div
                        className={cn(
                          "max-w-[80%] rounded-2xl px-3 py-2 text-sm relative",
                          m.sender === "admin"
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted text-foreground rounded-bl-md"
                        )}
                      >
                        {m.sender !== "admin" && (
                          <p className="text-[10px] font-semibold mb-0.5 opacity-70">{activeSession?.reseller_name}</p>
                        )}
                        {displayText && <p className="leading-relaxed">{displayText}</p>}
                        {product && <ProductAttachmentCard product={product} />}
                        {imageUrl && (
                          <img
                            src={imageUrl}
                            alt="attachment"
                            className="mt-1 rounded-lg max-w-full max-h-48 object-cover cursor-pointer"
                            onClick={() => window.open(imageUrl, "_blank")}
                          />
                        )}
                        <p className={cn(
                          "text-[9px] mt-1",
                          m.sender === "admin" ? "text-primary-foreground/60" : "text-muted-foreground/60"
                        )}>
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
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || !activeSessionId}
                    className="p-1.5 rounded-full hover:bg-accent transition-colors disabled:opacity-40"
                    title="Attach image"
                  >
                    <ImagePlus className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    placeholder={uploading ? "Uploading image..." : "Type a message..."}
                    className="flex-1 bg-transparent text-sm py-1.5 focus:outline-none placeholder:text-muted-foreground disabled:opacity-60"
                    disabled={uploading}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={(!input.trim() && !uploading) || uploading}
                    className="p-1.5 rounded-full bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
