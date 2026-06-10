import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Shield, Lock, Activity, Users, Key, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Role {
  name: string;
  users: number;
  description: string;
}

export function RolesPage() {
  const roles: Role[] = [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles & Permissions</h1>
          <p className="text-sm text-muted-foreground">Define and manage access levels for your team.</p>
        </div>
        <Button size="sm" className="gap-1.5 h-8">
          <Users className="h-3.5 w-3.5" />
          Create Role
        </Button>
      </div>

      <div className="grid gap-4">
        {roles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No roles available.
          </div>
        ) : (
          roles.map((role) => (
            <Card key={role.name} className="border-none shadow-theme-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    {role.name}
                  </CardTitle>
                  <StatusBadge label={`${role.users} Users`} variant="info" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">{role.description}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-8">Edit Permissions</Button>
                  <Button variant="ghost" size="sm" className="h-8">View Users</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

interface SecuritySetting {
  name: string;
  description: string;
  icon: React.ElementType;
  status: string;
}

export function SecurityPage() {
  const settings: SecuritySetting[] = [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security Settings</h1>
        <p className="text-sm text-muted-foreground">Configure system-wide security protocols.</p>
      </div>

      <div className="grid gap-4">
        {settings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No security settings available.
          </div>
        ) : (
          settings.map((setting) => (
            <Card key={setting.name} className="border-none shadow-theme-sm">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex gap-4">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <setting.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">{setting.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{setting.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge 
                      label={setting.status} 
                      variant={setting.status === "Enabled" ? "success" : setting.status === "Disabled" ? "danger" : "info"} 
                    />
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs">Configure</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from "@/components/ui/dialog";

interface SystemLog {
  id: string;
  timestamp: string;
  level: "ERROR" | "WARN" | "INFO";
  source: string;
  message: string;
  action: string;
  admin_email: string;
  ip_address: string;
  details: Record<string, unknown> | null;
}

export function SystemLogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase
          .from("admin_audit_logs")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        
        if (data) {
          setLogs(data.map(d => {
            const isError = d.action === "ERROR";
            return {
              id: d.id,
              timestamp: new Date(d.created_at).toLocaleString(),
              level: isError ? "ERROR" : "INFO",
              source: d.target || "System",
              message: `Action: ${d.action} by ${d.admin_email} - IP: ${d.ip_address || 'Unknown'}`,
              action: d.action,
              admin_email: d.admin_email || "System",
              ip_address: d.ip_address || "Unknown",
              details: d.details
            };
          }));
        }
      } catch (e) {
        console.error("Failed to fetch system logs", e);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Logs</h1>
          <p className="text-sm text-muted-foreground">Monitor system events and technical logs.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-8">
          <Download className="h-3.5 w-3.5" />
          Export Logs
        </Button>
      </div>

      <Card className="border-none shadow-theme-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                {["Timestamp", "Level", "Source", "Message"].map((h) => (
                  <th key={h} className="text-left p-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider first:pl-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono text-[11px]">
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-muted-foreground">Loading logs...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-muted-foreground">No system logs found.</td>
                </tr>
              ) : logs.map((log) => (
                <tr 
                  key={log.id} 
                  className="hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => setSelectedLog(log)}
                >
                  <td className="p-3.5 pl-5 text-muted-foreground whitespace-nowrap">{log.timestamp}</td>
                  <td className="p-3.5">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold",
                      log.level === "ERROR" ? "bg-danger/10 text-danger" :
                      log.level === "WARN" ? "bg-warning/10 text-warning" :
                      "bg-info/10 text-info"
                    )}>
                      {log.level}
                    </span>
                  </td>
                  <td className="p-3.5 text-foreground">{log.source}</td>
                  <td className="p-3.5 text-foreground max-w-md truncate">{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg text-foreground font-bold font-sans">
              <span className={cn(
                "px-2 py-0.5 text-xs rounded-full border font-mono",
                selectedLog?.level === "ERROR" ? "bg-danger/10 text-danger border-danger/20" : "bg-primary/10 text-primary border-primary/20"
              )}>
                {selectedLog?.level}
              </span>
              <span className="truncate">{selectedLog?.source}</span>
            </DialogTitle>
            <DialogDescription className="font-sans">
              Detailed logs and action event metadata
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4 text-xs font-sans">
            {/* Log basic information grid */}
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/40 rounded-lg border border-border/50 text-foreground">
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Email</span>
                <span className="font-medium">{selectedLog?.admin_email}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase font-semibold">IP Address</span>
                <span className="font-mono">{selectedLog?.ip_address}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Timestamp</span>
                <span>{selectedLog?.timestamp}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Log Ticket ID</span>
                <span className="font-mono text-[10px] text-muted-foreground truncate block select-all">{selectedLog?.id}</span>
              </div>
            </div>

            {/* Custom Metadata Details */}
            {selectedLog?.details && Object.keys(selectedLog.details).filter(k => k !== 'lastClicks').length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Log Payload Metadata</h4>
                <div className="bg-slate-950 text-slate-100 p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-48 border border-slate-800">
                  <pre>{(() => {
                    const meta = { ...selectedLog.details };
                    delete meta.lastClicks;
                    return JSON.stringify(meta, null, 2);
                  })()}</pre>
                </div>
              </div>
            )}

            {/* Timelines (User Click steps leading up to error/action) */}
            {selectedLog?.details && 'lastClicks' in selectedLog.details && Array.isArray(selectedLog.details.lastClicks) && selectedLog.details.lastClicks.length > 0 ? (
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-bold">
                  <Activity className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                  User Interaction Timeline (Last {selectedLog.details.lastClicks.length} Clicks)
                </h4>
                <div id="sys-timeline-container" className="relative pl-5 border-l-2 border-dashed border-border/60 py-1 space-y-4 font-sans">
                  {(selectedLog.details.lastClicks as string[]).map((click, index, arr) => {
                    const isLast = index === arr.length - 1;
                    return (
                      <div key={index} className="relative group" id={`sys-timeline-step-${index}`}>
                        {/* Step bubble on the line */}
                        <div className={`absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 bg-background flex items-center justify-center transition-all ${
                          isLast 
                            ? "border-red-500 scale-110 shadow-sm shadow-red-500/20" 
                            : "border-primary/60"
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isLast ? "bg-red-500" : "bg-primary/60"}`} />
                        </div>
                        
                        <div className={`text-xs p-2.5 rounded-md border transition-all ${
                          isLast 
                            ? "bg-red-500/5 border-red-500/20 shadow-theme-sm" 
                            : "bg-muted/30 border-border/40 hover:bg-muted/50"
                        }`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`font-mono text-foreground font-medium ${isLast ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                              Step {index + 1}: {click}
                            </span>
                            {isLast && (
                              <span className="text-[9px] font-bold text-red-500 tracking-wider uppercase bg-red-500/10 px-1.5 py-0.5 rounded shrink-0">
                                Context Trigger Action
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : selectedLog?.level === 'ERROR' ? (
              <div className="text-xs text-muted-foreground bg-muted p-3 rounded border text-center">
                No user click timeline was recorded for this malfunction event.
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="font-sans" onClick={() => setSelectedLog(null)}>
              Close Detail Viewer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { Globe, Download } from "lucide-react";
import { cn } from "@/lib/utils";
