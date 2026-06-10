import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdmins, type AdminUser } from "@/hooks/use-admins";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Search, MoreVertical, UserPlus, Shield, Mail, Clock, Trash2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useMemo, useState } from "react";
import { AddAdminModal } from "@/components/admin/AddAdminModal";
import { ResetPasswordModal } from "@/components/admin/ResetPasswordModal";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useAdminLogger } from "@/hooks/use-admin-logger";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AdminAdminsPage() {
  const { data: admins, isLoading } = useAdmins();
  const { canSeeAll, allowedIds, isOwner } = useAdminAccess();
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [userToResetPassword, setUserToResetPassword] = useState<AdminUser | null>(null);

  const queryClient = useQueryClient();
  const { logActivity } = useAdminLogger();

  const deleteUserMutation = useMutation({
    mutationFn: async (user: AdminUser) => {
      // 1. Delete from users table
      const { error: userError } = await supabase.from("users").delete().eq("id", user.id);
      if (userError) throw userError;
      
      // 2. Also delete from sla_admins or sla_staff
      const collections = ["sla_admins", "sla_staff"];
      for (const coll of collections) {
        const { error: collError } = await supabase
          .from(coll)
          .delete()
          .eq("email", user.email.toLowerCase().trim());
        if (collError) console.error(`Error deleting from ${coll}:`, collError);
      }
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admins"] });
      queryClient.invalidateQueries({ queryKey: ["sla_admins"] });
      queryClient.invalidateQueries({ queryKey: ["sla_staff"] });
      toast.success("User access removed");
      
      logActivity('DATA_DELETE', `Admin Removed: ${variables.name}`, { id: variables.id, email: variables.email, name: variables.name, role: variables.role });
      
      setUserToDelete(null);
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : "An error occurred";
      toast.error(`Error removing access: ${message}`);
      setUserToDelete(null);
    },
  });

  const toggleUserStatusMutation = useMutation({
    mutationFn: async ({ userId, currentStatus }: { userId: string; currentStatus: string }) => {
      const newStatus = currentStatus === "Active" ? "Suspended" : "Active";
      const { error } = await supabase
        .from("users")
        .update({ status: newStatus })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admins"] });
      toast.success("User status updated");

      const adminUser = admins?.find(a => a.id === variables.userId);
      const newStatus = variables.currentStatus === "Active" ? "Suspended" : "Active";
      const name = adminUser?.name || "Unknown Admin";
      const actionSubject = newStatus === "Suspended" ? "Admin Suspended" : "Admin Activated";
      
      logActivity('DATA_UPDATE', `${actionSubject}: ${name}`, { id: variables.userId, name, email: adminUser?.email, newStatus });
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : "An error occurred";
      toast.error(`Error updating status: ${message}`);
    },
  });

  const filteredAdmins = useMemo(() => {
    if (!admins) return [];
    
    let result = admins;
    
    // Row-level filtering
    if (!canSeeAll) {
      result = result.filter(admin => allowedIds.includes(admin.id));
    }
    
    // Search filtering
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(admin => 
        admin.name.toLowerCase().includes(q) || 
        admin.email.toLowerCase().includes(q)
      );
    }
    
    return result;
  }, [admins, canSeeAll, allowedIds, searchQuery]);

  const getRoleVariant = (role: AdminUser["role"]) => {
    switch (role) {
      case "Owner": return "danger";
      case "Admin": return "warning";
      case "User": return "info";
      default: return "default";
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Administrators</h1>
          <p className="text-sm text-muted-foreground">
            Manage system administrators and their access levels.
          </p>
        </div>
        <Button size="sm" className="gap-1.5 h-8" onClick={() => setIsAddModalOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" />
          Add Admin
        </Button>
      </div>

      <AddAdminModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} />

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 w-full sm:w-72">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Search admins..." 
          className="bg-transparent border-none outline-none text-sm w-full h-6 focus-visible:ring-0 p-0" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Card className="border-none shadow-theme-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                {["Administrator", "Role", "Last Login", "Status", ""].map((h) => (
                  <th key={h} className="text-left p-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider first:pl-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">Loading administrators...</td>
                </tr>
              ) : filteredAdmins.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">No administrators found.</td>
                </tr>
              ) : (
                filteredAdmins.map((admin) => (
                  <tr key={admin.id} className="hover:bg-accent/50 transition-colors">
                    <td className="p-3.5 pl-5">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                          {admin.name.split(" ").map(n => n[0]).join("").toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">{admin.name}</span>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {admin.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5">
                        <Shield className={`h-3.5 w-3.5 ${admin.role === "Owner" ? "text-danger" : admin.role === "Admin" ? "text-warning" : "text-info"}`} />
                        <StatusBadge label={admin.role} variant={getRoleVariant(admin.role)} />
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {format(new Date(admin.lastLogin), "MMM d, HH:mm")}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <StatusBadge label={admin.status} variant={admin.status === "Active" ? "success" : "default"} />
                    </td>
                    <td className="p-3.5 pr-5">
                      <DropdownMenu>
                        <DropdownMenuTrigger 
                          className="p-1.5 rounded-md hover:bg-accent transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4 text-muted-foreground" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            className="gap-2"
                            onClick={() => toggleUserStatusMutation.mutate({ userId: admin.id, currentStatus: admin.status })}
                          >
                            {admin.status === "Active" ? (
                              <>
                                <ShieldAlert className="h-4 w-4 text-warning" />
                                Suspend Access
                              </>
                            ) : (
                              <>
                                <ShieldCheck className="h-4 w-4 text-success" />
                                Activate Access
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2">
                            Edit Permissions
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2" onClick={() => setUserToResetPassword(admin)}>
                            Reset Password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="gap-2 text-destructive focus:text-destructive"
                            onClick={() => setUserToDelete(admin)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove Access
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove access for <strong>{userToDelete?.name}</strong>. They will no longer be able to sign in to the admin portal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => userToDelete && deleteUserMutation.mutate(userToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Modal */}
      {userToResetPassword && (
        <ResetPasswordModal
          open={!!userToResetPassword}
          onOpenChange={(open) => !open && setUserToResetPassword(null)}
          userId={userToResetPassword.id}
          userName={userToResetPassword.name}
          userEmail={userToResetPassword.email}
          userRole={userToResetPassword.role}
        />
      )}
    </div>
  );
}
