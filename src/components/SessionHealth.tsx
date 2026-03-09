import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Wifi, WifiOff, AlertTriangle, CheckCircle } from "lucide-react";
import type { TelegramAccount } from "@/pages/Index";

interface SessionHealthProps {
  accounts: TelegramAccount[];
  onUpdateAccountStatus: (accountId: string, status: TelegramAccount["status"], statusMessage?: string) => void;
}

interface HealthCheckResult {
  connectedAccounts: number;
  totalAccounts: number;
  sessionId?: string;
  isActive?: boolean;
  lastCheck?: Date;
  errors: string[];
}

export function SessionHealth({ accounts, onUpdateAccountStatus }: SessionHealthProps) {
  const [isEnabled, setIsEnabled] = useState(() => 
    localStorage.getItem("auto_session_health") === "true"
  );
  const [healthResult, setHealthResult] = useState<HealthCheckResult>({ 
    connectedAccounts: 0, 
    totalAccounts: 0,
    errors: []
  });
  const [isChecking, setIsChecking] = useState(false);
  const [lastAutoCheck, setLastAutoCheck] = useState<Date | null>(null);

  const checkSessionHealth = useCallback(async () => {
    setIsChecking(true);
    try {
      // Get active monitoring session
      const { data: sessions } = await supabase
        .from("monitoring_sessions")
        .select("*")
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!sessions || sessions.length === 0) {
        setHealthResult({ 
          connectedAccounts: 0, 
          totalAccounts: accounts.length,
          lastCheck: new Date(),
          errors: ["لا توجد جلسة مراقبة نشطة"]
        });
        return;
      }

      const session = sessions[0];
      
      // Check monitoring status
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "getMonitoringStatus",
          sessionId: session.id
        }
      });

      if (error) throw error;

      const result: HealthCheckResult = {
        connectedAccounts: data.connectedAccounts || 0,
        totalAccounts: accounts.length,
        sessionId: session.id,
        isActive: data.active,
        lastCheck: new Date(),
        errors: data.errors || []
      };

      setHealthResult(result);

      // Update account statuses based on health check
      if (result.connectedAccounts < accounts.length) {
        const disconnectedCount = accounts.length - result.connectedAccounts;
        console.log(`${disconnectedCount} حساب منقطع - تحديث الحالات`);
        
        // Mark accounts with connection issues
        accounts.forEach((account, index) => {
          if (index >= result.connectedAccounts) {
            onUpdateAccountStatus(account.id, "disconnected", "انقطاع في الاتصال - يحتاج إعادة تشغيل");
          }
        });
      }

    } catch (error) {
      console.error("فشل فحص صحة الجلسات:", error);
      setHealthResult({ 
        connectedAccounts: 0, 
        totalAccounts: accounts.length,
        lastCheck: new Date(),
        errors: [`خطأ في الفحص: ${error.message}`]
      });
    } finally {
      setIsChecking(false);
    }
  }, [accounts, onUpdateAccountStatus]);

  const autoRestartSessions = useCallback(async () => {
    if (!healthResult.sessionId || !healthResult.isActive) return;

    try {
      // Stop current monitoring
      await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "stopMonitoring",
          sessionId: healthResult.sessionId
        }
      });

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Restart monitoring with all accounts
      const selectedAccounts = accounts.filter(a => a.isSelected);
      if (selectedAccounts.length === 0) return;

      await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "startMonitoring",
          accounts: selectedAccounts.map(a => ({ phone: a.phone })),
          groups: ["__ALL__"],
          addAccounts: true,
          sessionId: crypto.randomUUID()
        }
      });

      console.log("تم إعادة تشغيل المراقبة تلقائياً");
    } catch (error) {
      console.error("فشل إعادة التشغيل التلقائي:", error);
    }
  }, [healthResult, accounts]);

  // Auto health check
  useEffect(() => {
    if (!isEnabled) return;

    const interval = setInterval(async () => {
      await checkSessionHealth();
      setLastAutoCheck(new Date());

      // Auto-restart if too many disconnected accounts
      if (healthResult.connectedAccounts > 0 && 
          healthResult.connectedAccounts < accounts.length * 0.5 && 
          accounts.length > 5) {
        console.log("اكتشاف انقطاع كبير - إعادة تشغيل تلقائي");
        await autoRestartSessions();
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [isEnabled, checkSessionHealth, autoRestartSessions, healthResult, accounts.length]);

  // Save auto-check preference
  useEffect(() => {
    localStorage.setItem("auto_session_health", String(isEnabled));
  }, [isEnabled]);

  const handleManualCheck = () => {
    checkSessionHealth();
  };

  const handleRestart = () => {
    autoRestartSessions();
  };

  const getHealthStatus = () => {
    if (!healthResult.lastCheck) return { status: "unknown", text: "غير محدد", icon: AlertTriangle };
    if (healthResult.connectedAccounts === 0) return { status: "critical", text: "حرج", icon: WifiOff };
    if (healthResult.connectedAccounts < healthResult.totalAccounts * 0.5) return { status: "warning", text: "تحذير", icon: AlertTriangle };
    if (healthResult.connectedAccounts === healthResult.totalAccounts) return { status: "good", text: "جيد", icon: CheckCircle };
    return { status: "partial", text: "جزئي", icon: Wifi };
  };

  const health = getHealthStatus();
  const StatusIcon = health.icon;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <StatusIcon className={`w-4 h-4 ${
              health.status === "good" ? "text-green-500" :
              health.status === "warning" ? "text-yellow-500" :
              health.status === "critical" ? "text-red-500" :
              "text-gray-400"
            }`} />
            مراقب صحة الجلسات
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={
              health.status === "good" ? "default" :
              health.status === "warning" ? "outline" :
              "destructive"
            }>
              {health.text}
            </Badge>
            <Switch
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
              size="sm"
            />
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">الحسابات المتصلة:</span>
            <span className="font-medium ml-2">
              {healthResult.connectedAccounts}/{healthResult.totalAccounts}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">آخر فحص:</span>
            <span className="font-medium ml-2">
              {healthResult.lastCheck ? 
                healthResult.lastCheck.toLocaleTimeString("ar") : 
                "لم يتم"}
            </span>
          </div>
        </div>

        {healthResult.errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                {healthResult.errors.map((error, index) => (
                  <div key={index} className="text-xs">{error}</div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualCheck}
            disabled={isChecking}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isChecking ? "animate-spin" : ""}`} />
            فحص يدوي
          </Button>
          
          {healthResult.connectedAccounts < healthResult.totalAccounts * 0.8 && healthResult.sessionId && (
            <Button
              variant="outline" 
              size="sm"
              onClick={handleRestart}
            >
              <Wifi className="w-4 h-4 mr-1" />
              إعادة تشغيل
            </Button>
          )}
        </div>

        {isEnabled && (
          <div className="text-xs text-muted-foreground">
            ✓ المراقبة التلقائية مُفعلة - فحص كل 30 ثانية
            {lastAutoCheck && (
              <span className="block">آخر فحص تلقائي: {lastAutoCheck.toLocaleTimeString("ar")}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}