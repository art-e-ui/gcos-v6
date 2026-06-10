import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Headset, Send, ImagePlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getOrCreateSession, ChatMessage } from '@/hooks/use-support';
import { playNotificationSound, startTabFlash } from '@/hooks/use-notifications';
import { uploadChatImage, encodeImageAttachment, parseImageAttachment } from '@/lib/chat-image-upload';
import { toast } from 'sonner';

export default function SupportChatDialog({ open, onClose, userName, resellerId }: { open: boolean; onClose: () => void; userName?: string; resellerId?: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Init session
  useEffect(() => {
    if (open) {
      getOrCreateSession(userName, resellerId).then(setSessionId);
    }
  }, [open, userName, resellerId]);

  // Realtime messages
  useEffect(() => {
    if (!sessionId) return;
    
    let isInitialLoad = true;

    const fetchMessages = async () => {
      try {
        const res = await fetch('/api/get-support-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId })
        });
        if (!res.ok) return;
        const result = await res.json();
        if (result.success && result.data) {
          const mapped = result.data.map((m: { id: string; session_id: string; sender: string; is_read: boolean; created_at: string; content?: string | null; message?: string | null }) => ({
            ...m,
            message: m.content || m.message || ""
          }));
          const sorted = [...mapped].reverse();
          setMessages(prev => {
            if (!isInitialLoad) {
              const prevIds = new Set(prev.map(m => m.id));
              const newSupportMsgs = sorted.filter(m => !prevIds.has(m.id) && m.sender === 'support');
              if (newSupportMsgs.length > 0) {
                playNotificationSound();
                if (document.hidden) startTabFlash();
              }
            }
            return sorted as ChatMessage[];
          });
          isInitialLoad = false;
        }
      } catch (err) {
        console.error("Error fetching messages:", err);
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [sessionId]);

  // Mark support messages as read
  useEffect(() => {
    if (!open || !sessionId || messages.length === 0) return;
    
    const unreadSupportMessages = messages.filter(m => m.sender === 'support' && !m.is_read);
    
    if (unreadSupportMessages.length > 0) {
      const markAsRead = async () => {
        try {
          const ids = unreadSupportMessages.map(m => m.id);
          await fetch('/api/mark-support-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_ids: ids })
          });
        } catch (e) {
          console.error("Failed to mark as read:", e);
        }
      };
      markAsRead();
    }
  }, [open, sessionId, messages]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Set offline on close
  useEffect(() => {
    if (!open && sessionId) {
      supabase.from('support_sessions').update({ is_online: false }).eq('id', sessionId).catch(console.error);
    }
  }, [open, sessionId]);

  const handleSend = async () => {
    if (!input.trim() || !sessionId) return;
    const msg = input.trim();
    setInput('');
    
    try {
      const res = await fetch('/api/send-support-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          sender: 'customer',
          content: msg
        })
      });
      
      if (!res.ok) throw new Error('Failed to send message');

      // Send push notification to reseller if applicable
      if (resellerId) {
        fetch('/api/send-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: resellerId,
            title: `New message from ${userName || 'Customer'}`,
            body: msg,
            data: {
              type: 'chat',
              sessionId: sessionId
            }
          })
        }).catch(err => console.error("[FCM] Failed to send push notification:", err));
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;
    
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
        const res = await fetch('/api/send-support-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            sender: 'customer',
            content: encodeImageAttachment(url, msgText)
          })
        });
        
        if (!res.ok) throw new Error('Failed to send image message');
        
        setInput('');
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md h-[75vh] sm:h-[500px] bg-background rounded-t-2xl sm:rounded-2xl border border-border shadow-xl flex flex-col animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Headset className="h-5 w-5 text-primary-foreground" />
            <div>
              <h2 className="font-bold text-sm text-primary-foreground">Customer Support</h2>
              <p className="text-[10px] text-primary-foreground/70">We typically reply within minutes</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-primary-foreground/20 transition-colors">
            <X className="h-5 w-5 text-primary-foreground" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Headset className="h-10 w-10 mx-auto mb-3 opacity-30" />
              Start a conversation with support
            </div>
          ) : (
            messages.map(m => {
              const { text: imgText, imageUrl } = parseImageAttachment(m.message);
              
              return (
                <div key={m.id} className={`flex ${m.sender === 'customer' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    m.sender === 'customer'
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted text-foreground rounded-bl-md'
                  }`}>
                    {imgText && <p className="leading-relaxed">{imgText}</p>}
                    {!imgText && !imageUrl && <p className="leading-relaxed">{m.message}</p>}
                    
                    {imageUrl && (
                      <img 
                        src={imageUrl} 
                        alt="attachment" 
                        className="w-full h-auto mt-2 rounded-lg object-contain border cursor-pointer"
                        onClick={() => window.open(imageUrl, "_blank")}
                      />
                    )}
                    <p className={`text-[9px] mt-1 ${m.sender === 'customer' ? 'text-primary-foreground/60' : 'text-muted-foreground/60'}`}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
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
              <ImagePlus className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
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
      </div>
    </div>
  );
}
