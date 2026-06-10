import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Admin" | "User"; // Mapping from db roles
  lastLogin: string;
  status: "Active" | "Inactive";
}

export function useAdmins() {
  return useQuery({
    queryKey: ["admins"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .in("role", ["owner", "admin", "staff"]);
        
        if (error) throw error;

        return (data || []).map((user) => ({
          id: user.id,
          name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown User',
          email: user.email || '',
          role: user.role === 'owner' ? 'Owner' : user.role === 'admin' ? 'Admin' : 'User',
          lastLogin: user.created_at || '',
          status: "Active",
        })) as AdminUser[];
      } catch (error) {
        console.error("Error fetching admins from Supabase:", error);
        return [];
      }
    },
    staleTime: 5000,
  });
}
