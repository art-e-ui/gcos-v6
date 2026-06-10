import React from 'react';
import { useAdminLogger, AdminActionType } from '@/hooks/use-admin-logger';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class AdminErrorBoundaryInner extends React.Component<Props & { logActivity: (action: AdminActionType, target: string, details?: Record<string, unknown> | string | null) => void }, State> {
  constructor(props: Props & { logActivity: (action: AdminActionType, target: string, details?: Record<string, unknown> | string | null) => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.props.logActivity('ERROR', 'System', { 
      message: error.message, 
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full bg-card rounded-xl border border-destructive/20 shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4 text-destructive">
              <AlertCircle className="h-6 w-6" />
              <h2 className="text-xl font-semibold">Something went wrong</h2>
            </div>
            <p className="text-sm text-card-foreground mb-6">
              An unexpected error occurred in the administrative panel. The error has been logged for review.
            </p>
            {this.state.error && (
              <div className="bg-muted p-3 flex rounded-md mb-6 overflow-x-auto">
                 <pre className="text-xs text-muted-foreground font-mono">
                    {this.state.error.message}
                 </pre>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => window.location.reload()} variant="outline">
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function AdminErrorBoundary({ children }: Props) {
  const { logActivity } = useAdminLogger();
  return <AdminErrorBoundaryInner logActivity={logActivity}>{children}</AdminErrorBoundaryInner>;
}
