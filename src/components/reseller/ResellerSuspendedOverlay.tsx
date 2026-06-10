import { Headset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { resellerPath } from "@/lib/subdomain";

export function ResellerSuspendedOverlay() {
  const navigate = useNavigate();

  const handleSupportClick = () => {
    navigate(resellerPath("/reseller/messages"), { state: { tab: "support" } });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm p-4">
      <div className="bg-card border border-destructive/20 p-6 rounded-xl shadow-xl max-w-sm w-full text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <Headset className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Shop Suspended</h2>
        <p className="text-muted-foreground mb-6">
          Your shop has been suspended due to low credibility. Please contact support to resolve the issue.
        </p>
        <Button onClick={handleSupportClick} className="w-full gap-2">
          <Headset className="h-4 w-4" />
          Contact Support
        </Button>
      </div>
    </div>
  );
}
