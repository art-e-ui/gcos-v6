import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAdminLogger } from "@/hooks/use-admin-logger";
import { KeyRound, Eye, EyeOff, Shuffle } from "lucide-react";

interface ResetPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
}

export function ResetPasswordModal({
  open,
  onOpenChange,
  userId,
  userName,
  userEmail,
  userRole,
}: ResetPasswordModalProps) {
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { logActivity } = useAdminLogger();

  const handleGeneratePassword = () => {
    // Generate a secure but readble 10-char password
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let generated = "";
    for (let i = 0; i < 10; i++) {
      generated += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(generated);
    setShowPassword(true);
    toast.success("Generated random secure password");
  };

  const handleResetToDefault = () => {
    setPassword("12345678");
    setShowPassword(true);
    toast.success("Set password to '12345678'");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/admin/reset-admin-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password");
      }

      toast.success(`Password reset successfully for ${userName}`);
      
      // Log this activity securely
      logActivity(
        "DATA_UPDATE",
        `Reset password for ${userRole}: ${userName} (${userEmail})`,
        {
          targetUserId: userId,
          targetUserEmail: userEmail,
          targetUserRole: userRole,
        }
      );

      setPassword("");
      onOpenChange(false);
    } catch (error: unknown) {
      console.error("Error resetting password:", error);
      const err = error as Error;
      toast.error(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Reset Password
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 text-sm text-muted-foreground">
          You are changing the security key for <strong className="text-foreground">{userName}</strong> ({userEmail}).
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">New Security Key / Password</Label>
            <div className="relative flex items-center">
              <Input
                id="new-password"
                required
                type={showPassword ? "text" : "password"}
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter at least 6 characters"
                className="pr-20"
              />
              <div className="absolute right-1 flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={handleGeneratePassword}
                  title="Generate safe password"
                >
                  <Shuffle className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleResetToDefault}
              className="text-xs py-1 h-7 text-muted-foreground hover:text-foreground"
            >
              Set default "12345678"
            </Button>
          </div>

          <DialogFooter className="pt-4 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPassword("");
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-1.5">
              {loading ? "Saving..." : "Change Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
