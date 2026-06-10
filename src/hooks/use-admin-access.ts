import { useMemo } from "react";
import { useAdminAuth } from "@/lib/admin-auth-context-hooks";
import { useDbSlaStaff, dbStaffToLegacy } from "./use-db-sla";

export function useAdminAccess() {
  const { session } = useAdminAuth();
  const { data: dbStaff } = useDbSlaStaff();

  return useMemo(() => {
    if (!session) {
      return {
        isOwner: false,
        isAdmin: false,
        isStaff: false,
        allowedStaffIds: [] as string[],
        allowedStaffDocIds: [] as string[],
        allowedReferralIds: [] as string[],
        allowedAdminIds: [] as string[],
        allowedIds: [] as string[],
        canSeeAll: false,
      };
    }

    if (session.role === "Owner") {
      return {
        isOwner: true,
        isAdmin: false,
        isStaff: false,
        allowedStaffIds: [] as string[],
        allowedStaffDocIds: [] as string[],
        allowedReferralIds: [] as string[],
        allowedAdminIds: [] as string[],
        allowedIds: [] as string[],
        canSeeAll: true,
        hasAccessToReseller: () => true,
      };
    }

    const allStaff = (dbStaff ?? []).map(dbStaffToLegacy);

    if (session.role === "Admin") {
      const myStaff = allStaff.filter((s) => s.createdByAdminId === session.accountId);
      const myStaffIds = myStaff.map((s) => s.staffId);
      const myStaffDocIds = myStaff.map((s) => s.id);
      
      const allowedStaffIds = myStaffIds.filter(Boolean) as string[];
      const allowedStaffDocIds = myStaffDocIds.filter(Boolean) as string[];
      const allowedReferralIds = myStaff.map((s) => s.referralId).filter(Boolean) as string[];
      const allowedAdminIds = [session.accountId, session.uid].filter(Boolean) as string[];
      const allowedIds = [session.accountId, session.uid, ...myStaffIds, ...myStaffDocIds].filter(Boolean) as string[];

      return {
        isOwner: false,
        isAdmin: true,
        isStaff: false,
        allowedStaffIds,
        allowedStaffDocIds,
        allowedReferralIds,
        allowedAdminIds,
        allowedIds,
        canSeeAll: false,
        hasAccessToReseller: (r: { referredBy?: string; memberOfAdminId?: string }) => {
          const referredBy = r.referredBy;
          const matchesStaff = !!(referredBy && (
            allowedReferralIds.includes(String(referredBy)) || 
            allowedStaffIds.includes(String(referredBy)) || 
            allowedStaffDocIds.includes(String(referredBy))
          ));
          const matchesAdmin = !!(r.memberOfAdminId && allowedAdminIds.includes(String(r.memberOfAdminId)));
          return matchesStaff || matchesAdmin;
        }
      };
    }

    if (session.role === "User") {
      const me = allStaff.find((s) => s.staffId === session.accountId || s.id === session.uid);
      const allowedStaffIds = me ? [me.staffId] : [];
      const allowedStaffDocIds = me ? [me.id] : [];
      const allowedReferralIds = me ? [me.referralId] : [];
      const allowedAdminIds = me ? [me.createdByAdminId] : [];
      const allowedIds = session.accountId ? [session.accountId] : [];

      return {
        isOwner: false,
        isAdmin: false,
        isStaff: true,
        allowedStaffIds,
        allowedStaffDocIds,
        allowedReferralIds,
        allowedAdminIds,
        allowedIds,
        canSeeAll: false,
        hasAccessToReseller: (r: { referredBy?: string; memberOfAdminId?: string }) => {
          const referredBy = r.referredBy;
          return !!(referredBy && (
            allowedReferralIds.includes(String(referredBy)) || 
            allowedStaffIds.includes(String(referredBy)) || 
            allowedStaffDocIds.includes(String(referredBy))
          ));
        }
      };
    }

    return {
      isOwner: false,
      isAdmin: false,
      isStaff: false,
      allowedStaffIds: [] as string[],
      allowedStaffDocIds: [] as string[],
      allowedReferralIds: [] as string[],
      allowedAdminIds: [] as string[],
      allowedIds: [] as string[],
      canSeeAll: false,
      hasAccessToReseller: () => false,
    };
  }, [session, dbStaff]);
}
