import React, { useState, useEffect, useRef } from "react";
import { 
  MessageSquare, Store, Send, ShoppingCart, Users, ImagePlus, Circle, Search, Trash2
} from "lucide-react";
import { STATIC_VIRTUAL_PROFILES } from "@/data/virtualProfiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger 
} from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useNavigate, useLocation } from "react-router-dom";
import { useDbProducts } from "@/hooks/use-db-products";
import type { Product, Reseller } from "@/lib/types";
import { adminPath } from "@/lib/subdomain";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { uploadChatImage } from "@/lib/chat-image-upload";
import { useResellerChat, getOrCreateResellerChatSession } from "@/hooks/use-reseller-chat";
import { supabase } from "@/lib/supabase";
import { cn, parseImageUrl, getProductPlaceholder, handleImageError } from "@/lib/utils";
import { encodeImageAttachment, parseImageAttachment } from "@/lib/chat-image-upload";
import { playNotificationSound, startTabFlash } from "@/hooks/use-notifications";

interface VirtualProfile {
  id: string;
  name: string;
  avatar?: string;
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

export default function VirtualCustomerServicesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: dbProducts = [] } = useDbProducts();
  const resellers = useUnifiedResellers();
  const { canSeeAll, hasAccessToReseller } = useAdminAccess();
  
  const [virtualProfiles] = useState<VirtualProfile[]>(STATIC_VIRTUAL_PROFILES as VirtualProfile[]);
  const [selectedVirtualProfile, setSelectedVirtualProfile] = useState<VirtualProfile | null>(STATIC_VIRTUAL_PROFILES[0] as VirtualProfile);
  const [selectedResellerId, setSelectedResellerId] = useState<string | null>(null);
  const [resellerSearch, setResellerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const lastValidReseller = useRef<Reseller | null>(null);
  
  const filteredResellers = React.useMemo(() => {
    let list = resellers || [];
    if (!canSeeAll) {
      list = list.filter((r) => hasAccessToReseller(r));
    }
    if (resellerSearch.trim()) {
      const q = resellerSearch.toLowerCase();
      list = list.filter(r => 
        r.firstName.toLowerCase().includes(q) || 
        r.lastName.toLowerCase().includes(q) || 
        r.shopName.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.resellerId.toString().includes(q)
      );
    }
    return list;
  }, [resellers, canSeeAll, hasAccessToReseller, resellerSearch]);

  const selectedReseller = React.useMemo(() => {
    const found = filteredResellers.find(r => r.id === selectedResellerId);
    if (found) {
      lastValidReseller.current = found;
      return found;
    }
    if (selectedResellerId && lastValidReseller.current?.id === selectedResellerId) {
      return lastValidReseller.current;
    }
    return null;
  }, [filteredResellers, selectedResellerId]);

  const [onlineStatus, setOnlineStatus] = useState<Record<string, boolean>>({});
  const hasInitialized = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const { messages, sendMessage } = useResellerChat(sessionId);

  const [newMessage, setNewMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mark reseller messages as read
  useEffect(() => {
    if (messages.length === 0 || !sessionId) return;
    const unread = messages.filter(m => m.sender === "reseller" && !m.is_read);
    
    if (unread.length > 0) {
      const markAsRead = async () => {
        for (const msg of unread) {
          await supabase.from('reseller_chat_messages').update({ is_read: true }).eq('id', msg.id);
        }
      };
      markAsRead().catch(console.error);
    }
  }, [messages, sessionId]);

  // Online status listener
  useEffect(() => {
    const fetchStatus = async () => {
      const { data } = await supabase.from('reseller_chat_sessions').select('reseller_id, is_online');
      if (data) {
        const status: Record<string, boolean> = {};
        data.forEach(s => {
          if (s.reseller_id) {
            status[s.reseller_id] = status[s.reseller_id] || s.is_online === true;
          }
        });
        setOnlineStatus(status);
      }
    };

    const channel = supabase
      .channel('reseller_online_status')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'reseller_chat_sessions' 
      }, async () => {
        await fetchStatus();
      })
      .subscribe();
      
    fetchStatus();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const resellerIdFromState = location.state?.resellerId;

  useEffect(() => {
    if (resellers.length > 0 && !hasInitialized.current) {
      if (resellerIdFromState) {
        const resellerFound = resellers.find(r => r.id === resellerIdFromState);
        if (resellerFound) {
          setSelectedResellerId(resellerFound.id);
          hasInitialized.current = true;
        }
      } else if (!selectedResellerId) {
        setSelectedResellerId(resellers[0].id);
        hasInitialized.current = true;
      }
    }
  }, [resellers, resellerIdFromState, selectedResellerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const filteredProducts = React.useMemo(() => {
    const targetProductIds = selectedProductIds.length > 0 ? selectedProductIds : dbProducts.map(p => p.id);
    let prods = dbProducts.filter(p => targetProductIds.includes(p.id));
    if (selectedProductIds.length > 0 && prods.length === 0) {
      prods = dbProducts;
    }
    if (!productSearch.trim()) return prods;
    const q = productSearch.toLowerCase();
    return prods.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.sku?.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q)
    );
  }, [dbProducts, selectedProductIds, productSearch]);

  // Session management
  useEffect(() => {
    if (!selectedReseller || !selectedVirtualProfile) {
      setSessionId(null);
      setSelectedProductIds([]);
      return;
    }

    const fetchSelection = async () => {
      const { data } = await supabase
        .from('reseller_product_selection')
        .select('product_id')
        .eq('reseller_id', selectedReseller.id);
        
      if (data) {
        setSelectedProductIds(data.map(d => d.product_id));
      }
    };
    fetchSelection();

    const initSession = async () => {
      try {
        const sId = await getOrCreateResellerChatSession(
          selectedVirtualProfile.id,
          selectedVirtualProfile.name,
          selectedReseller.id
        );
        setSessionId(sId);
      } catch (error) {
        console.error("Error in initSession:", error);
      }
    };
    initSession();
  }, [selectedReseller, selectedVirtualProfile]);

  const handleSendMessage = async (text?: string) => {
    const messageText = text || newMessage;
    
    if (!selectedReseller || !selectedVirtualProfile || !sessionId) {
      toast.error("Please select a reseller and wait for connection.");
      return;
    }

    if (!messageText.trim()) return;
    
    try {
      await sendMessage(messageText, "customer");
      
      // Send push notification to reseller
      fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedReseller.id,
          title: `New message from ${selectedVirtualProfile.name}`,
          body: messageText,
          data: {
            type: 'chat',
            sessionId: sessionId
          }
        })
      }).catch(err => console.error("[FCM] Failed to send push notification:", err));

      if (!text) setNewMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message");
    }
  };

  const handleProductClick = (product: Product) => {
    const payload = JSON.stringify({ id: product.id, name: product.name, price: product.price, image: product.image });
    const msg = `[PRODUCT_ATTACH:${payload}]`;
    handleSendMessage(msg);
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
        await handleSendMessage(encodeImageAttachment(url, newMessage.trim()));
        setNewMessage("");
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
      await supabase.from('reseller_chat_messages').delete().eq('id', messageId);
      toast.success("Message deleted");
    } catch (error) {
      console.error("Error deleting message:", error);
      toast.error("Failed to delete message");
    }
  };

  const handleOrderNow = () => {
    if (!selectedReseller) {
      toast.error("Please select a reseller first");
      return;
    }
    navigate(adminPath("/admin/customer-care/order-services"), { state: { reseller: selectedReseller } });
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col bg-background relative">
      {/* Header Widget */}
      <div className="border-b p-2 flex justify-between items-center bg-card">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <MessageSquare className="h-5 w-5" /> Virtual Chat
        </h1>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">
              {selectedVirtualProfile ? `Acting as: ${selectedVirtualProfile.name}` : "Select Virtual Profile"}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[400px] sm:w-[540px]">
            <SheetHeader>
              <SheetTitle>Select Virtual Profile</SheetTitle>
            </SheetHeader>
            <div className="p-4 space-y-2 max-h-[80vh] overflow-y-auto">
              {virtualProfiles.map(profile => (
                <Button 
                  key={profile.id} 
                  variant={selectedVirtualProfile?.id === profile.id ? "default" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => setSelectedVirtualProfile(profile)}
                >
                  {profile.name} ({profile.id})
                </Button>
              ))}
              {virtualProfiles.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No virtual profiles found.</div>
              )}
            </div>
          </SheetContent>
        </Sheet>
        <Button 
          className="gap-2"
          onClick={handleOrderNow}
        >
          <ShoppingCart className="h-4 w-4" />
          Order Now
        </Button>
      </div>

      {/* Main Layout: 1.5 : 4 : 1.5 */}
      <div className="flex-1 grid grid-cols-[1.5fr_4fr_1.5fr] overflow-hidden">
        
        {/* Left Panel: Reseller Profiles */}
        <div className="border-r p-0 flex flex-col bg-muted/30 overflow-hidden">
          <div className="p-4 border-b bg-card space-y-3">
            <h2 className="font-semibold flex items-center gap-2 text-primary">
              <Users className="h-4 w-4" /> Reseller Conversations
            </h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search resellers..." 
                className="pl-9 h-9 text-sm"
                value={resellerSearch}
                onChange={(e) => setResellerSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredResellers.map(reseller => {
              const isOnline = onlineStatus[reseller.id] || false;
              return (
                <Button 
                  key={reseller.id} 
                  variant={selectedReseller?.id === reseller.id ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start text-left h-auto py-3 px-3 gap-3 relative",
                    selectedReseller?.id === reseller.id && "bg-accent"
                  )}
                  onClick={() => setSelectedResellerId(reseller.id)}
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                      {reseller.firstName.charAt(0)}
                    </div>
                    <Circle className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5",
                      isOnline ? "fill-emerald-500 text-emerald-500" : "fill-muted text-muted-foreground"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0 font-sans">
                    <div className="font-medium truncate text-foreground">{reseller.firstName} {reseller.lastName}</div>
                    <div className="text-[10px] text-primary font-mono font-semibold mt-0.5">
                      GRS-{reseller.resellerId || "000"}
                    </div>
                    <div className="text-[10px] opacity-70 truncate text-muted-foreground">{reseller.shopName || "No Shop Name"}</div>
                    <div className={cn(
                      "text-[10px] font-medium mt-0.5",
                      isOnline ? "text-emerald-600" : "text-muted-foreground"
                    )}>
                      {isOnline ? "Online" : "Offline"}
                    </div>
                  </div>
                </Button>
              );
            })}
            {filteredResellers.length === 0 && (
              <div className="text-center text-muted-foreground py-8 text-sm">No resellers found.</div>
            )}
          </div>
        </div>

        {/* Middle Panel: Chat */}
        <div className="flex flex-col bg-background overflow-hidden relative">
          {/* Chat header */}
          {selectedReseller && (
            <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-card">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {selectedReseller.firstName.charAt(0)}
                  </div>
                  <Circle className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5",
                    onlineStatus[selectedReseller.id] ? "fill-emerald-500 text-emerald-500" : "fill-muted text-muted-foreground"
                  )} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{selectedReseller.firstName} {selectedReseller.lastName}</p>
                    <span className="text-xs bg-primary/10 text-primary font-mono font-medium px-2 py-0.5 rounded-full">
                      GRS-{selectedReseller.resellerId || "000"}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    {selectedReseller.shopName || "No Shop Name"}
                    <span className={cn(
                      "ml-1 font-medium",
                      onlineStatus[selectedReseller.id] ? "text-emerald-600" : ""
                    )}>
                      · {onlineStatus[selectedReseller.id] ? "Online" : "Offline"}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/5">
            {!selectedReseller ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 p-8">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <MessageSquare className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Select a Reseller</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Choose a reseller from the left panel to start a virtual customer service conversation.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-2 p-8">
                    <p className="text-sm text-muted-foreground italic">No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const { text: productText, product } = parseAttachment(msg.message);
                    const { text: imgText, imageUrl } = parseImageAttachment(product ? productText : msg.message);
                    const displayText = product ? productText : imgText;

                    return (
                      <div key={msg.id} className={`flex ${msg.sender === "admin" || msg.sender === "customer" ? "flex-row-reverse" : "flex-row"} items-center gap-2 group`}>
                        <div className={`max-w-[70%] p-3 rounded-2xl shadow-sm relative ${
                          msg.sender === "admin" || msg.sender === "customer"
                            ? "bg-primary text-primary-foreground rounded-tr-none" 
                            : "bg-card text-card-foreground rounded-tl-none border"
                        }`}>
                          {displayText && <p className="text-sm">{displayText}</p>}
                          {product && (
                            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2 mt-1">
                              <img 
                                src={parseImageUrl(product.image, product.name)} 
                                alt={product.name} 
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded object-cover" 
                                onError={(e) => handleImageError(e, product.image)}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold truncate">{product.name}</p>
                                <p className="text-[10px] text-primary">${product.price}</p>
                              </div>
                            </div>
                          )}
                          {imageUrl && (
                            <img
                              src={imageUrl}
                              alt="attachment"
                              className="w-32 h-32 mt-2 rounded-lg object-cover border cursor-pointer"
                              onClick={() => window.open(imageUrl, "_blank")}
                            />
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="p-1.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete message"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t bg-card">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                disabled={!selectedReseller}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !selectedReseller}
                title="Attach image"
              >
                <ImagePlus className="h-5 w-5" />
              </Button>
              <Input 
                placeholder={!selectedReseller ? "Select a reseller first..." : uploading ? "Uploading image..." : "Type a message..."} 
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                onFocus={() => {
                  console.log("Input focused. selectedResellerId:", selectedResellerId, "resellers.length:", resellers.length);
                }}
                className="flex-1"
                disabled={uploading || !selectedReseller}
              />
              <Button size="icon" className="shrink-0" onClick={() => handleSendMessage()} disabled={uploading || !selectedReseller}>
                <Send className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Right Panel: Store Front */}
        <div className="p-4 space-y-4 bg-muted/30 overflow-y-auto">
          <div className="space-y-3">
            <h2 className="font-semibold flex items-center gap-2 text-primary">
              <Store className="h-4 w-4" /> Store Front
            </h2>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input 
                placeholder="Search products..." 
                className="pl-8 h-8 text-xs"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              />
            </div>
          </div>
          <div className="space-y-4">
            {filteredProducts.map((product) => (
              <Card key={product.id} className="overflow-hidden hover:ring-2 hover:ring-primary transition-all cursor-pointer group" onClick={() => handleProductClick(product)}>
                <img 
                  src={parseImageUrl(product.image, product.name)} 
                  alt={product.name} 
                  referrerPolicy="no-referrer"
                  className="w-full h-24 object-cover" 
                  onError={(e) => handleImageError(e, product.image)}
                />
                <CardContent className="p-2">
                  <p className="text-xs font-bold truncate">{product.name}</p>
                  <div className="flex justify-between items-center mt-1">
                    <p className="text-[10px] font-mono text-primary">${product.price}</p>
                    <p className="text-[10px] text-muted-foreground">ID: {product.id}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
            {selectedReseller && filteredProducts.length === 0 && (
              <div className="text-center text-muted-foreground py-8 text-xs italic">
                No products found.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
