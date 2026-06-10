import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Search, Filter, Download, User, Activity, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Log {
  id: string;
  admin_id: string;
  admin_email: string;
  action: string;
  target: string;
  timestamp: string;
  ip: string;
  details: Record<string, unknown> | null;
}

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase
          .from("admin_audit_logs")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        
        if (data) {
          const filteredData = data.filter(d => 
            d.action !== "VIEW_PAGE"
          );
          setLogs(filteredData.map(d => ({
            id: d.id,
            admin_id: d.admin_id,
            admin_email: d.admin_email,
            action: d.action,
            target: d.target || "-",
            timestamp: new Date(d.created_at).toLocaleString(),
            ip: d.ip_address || "Unknown",
            details: d.details
          })));
        }
      } catch (e) {
        console.error("Failed to fetch audit logs", e);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => {
    const term = searchTerm.toLowerCase();
    return (
      (log.admin_email || "").toLowerCase().includes(term) ||
      (log.action || "").toLowerCase().includes(term) ||
      (log.target || "").toLowerCase().includes(term) ||
      (log.ip || "").toLowerCase().includes(term) ||
      (log.timestamp || "").toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-sm text-muted-foreground">Track all administrative actions across the system.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-8">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 w-full sm:w-72">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Search logs..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="bg-transparent border-none outline-none text-sm w-full h-6 focus-visible:ring-0 p-0" 
        />
      </div>

      <Card className="border-none shadow-theme-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {["User", "Action", "Target", "Timestamp", "IP Address"].map((h) => (
                  <th key={h} className="text-left p-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider first:pl-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted-foreground">Loading logs...</td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted-foreground">No audit logs found.</td>
                </tr>
              ) : filteredLogs.map((log) => (
                <tr 
                  key={log.id} 
                  className="hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => setSelectedLog(log)}
                >
                  <td className="p-3.5 pl-5">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-[10px]">
                        {log.admin_email ? log.admin_email.substring(0, 2).toUpperCase() : "??"}
                      </div>
                      <span className="font-medium">{log.admin_email || "System"}</span>
                    </div>
                  </td>
                  <td className="p-3.5">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[11px] font-bold border",
                      log.action === "ERROR" ? "bg-danger/10 text-danger border-danger/20" :
                      log.action === "LOGIN" ? "bg-success/10 text-success border-success/20" :
                      log.action.startsWith("DATA_") ? "bg-warning/10 text-warning border-warning/20" :
                      "bg-muted text-muted-foreground border-border"
                    )}>
                      {log.action}
                    </span>
                  </td>
                  <td className="p-3.5 text-muted-foreground">{log.target}</td>
                  <td className="p-3.5">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {log.timestamp}
                    </div>
                  </td>
                  <td className="p-3.5 font-mono text-xs text-muted-foreground">{log.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="sm:max-w-[550px] max-h-[80vh] overflow-y-auto font-sans">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <span className={cn(
                "px-2 py-0.5 rounded text-xs font-bold",
                selectedLog?.action === "ERROR" ? "bg-danger/10 text-danger" : "bg-info/10 text-info"
              )}>
                {selectedLog?.action}
              </span>
              Audit Log Details
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm mt-2">
            <div className="grid grid-cols-2 gap-2 border-b border-border pb-3">
              <div>
                <span className="text-xs text-muted-foreground font-semibold">Timestamp:</span>
                <p className="font-mono text-xs text-foreground mt-0.5">{selectedLog?.timestamp}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground font-semibold">IP Address:</span>
                <p className="font-mono text-xs text-foreground mt-0.5">{selectedLog?.ip}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-b border-border pb-3">
              <div>
                <span className="text-xs text-muted-foreground font-semibold">Triggered By:</span>
                <p className="text-xs text-foreground mt-0.5 font-medium">{selectedLog?.admin_email}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground font-semibold">Action / Target:</span>
                <p className="text-xs text-foreground mt-0.5 font-mono">{selectedLog?.action} ({selectedLog?.target})</p>
              </div>
            </div>

            {selectedLog?.details && (
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground font-semibold">Activity Details / Metadata:</span>
                <pre className="p-3 bg-muted rounded-lg font-mono text-xs overflow-x-auto text-foreground border border-border">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            )}

            {selectedLog?.action === "ERROR" && selectedLog.details?.lastClicks && Array.isArray(selectedLog.details.lastClicks) && (
              <div className="space-y-2 border-t border-border pt-3">
                <span className="text-xs text-danger font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="h-4 w-4" />
                  Timeline leading up to malfunction (Last 8 Clicks):
                </span>
                <ol className="relative border-l border-muted-foreground/20 ml-2.5 space-y-3 pt-1">
                  {selectedLog.details.lastClicks.map((click: string, idx: number) => (
                    <li key={idx} className="mb-2 ml-4">
                      <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-muted-foreground/30 border border-background" />
                      <time className="text-[10px] text-muted-foreground font-mono">Step {idx + 1}</time>
                      <p className="text-xs font-mono font-medium text-foreground bg-accent/30 border border-border/50 px-2 py-1 rounded mt-0.5">{click}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
