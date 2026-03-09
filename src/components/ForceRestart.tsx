import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TelegramAccount } from "@/pages/Index";

interface ForceRestartProps {
  accounts: TelegramAccount[];
  onUpdateAccountStatus: (accountId: string, status: TelegramAccount["status"], statusMessage?: string) => void;
}

export function ForceRestart({ accounts, onUpdateAccountStatus }: ForceRestartProps) {
  const handleForceRestart = async () => {
    try {
      // Get accounts with complete session data
      const validAccounts = accounts.filter(a => 
        a.isSelected && 
        a.sessionString && 
        a.apiId && 
        a.apiHash &&
        a.status !== "banned"
      );

      if (validAccounts.length === 0) {
        alert("لا توجد حسابات صالحة للتشغيل\nتأكد من وجود جلسات محددة وصحيحة");
        return;
      }

      console.log(`بدء مراقبة جديدة بـ ${validAccounts.length} حساب`);

      const newSessionId = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "startMonitoring",
          accounts: validAccounts.map(a => ({ 
            phone: a.phone,
            sessionString: a.sessionString,
            apiId: a.apiId,
            apiHash: a.apiHash
          })),
          groups: ["__ALL__"],
          addAccounts: true,
          sessionId: newSessionId,
          targetGroup: "",
          supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
          supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
        }
      });

      if (error) throw error;

      // Update all selected accounts status to loading
      validAccounts.forEach(account => {
        onUpdateAccountStatus(account.id, "loading", "جاري الاتصال...");
      });

      console.log("تم بدء المراقبة بنجاح!");
      
    } catch (error) {
      console.error("فشل في بدء المراقبة:", error);
      alert(`خطأ: ${error.message}`);
    }
  };

  const validAccountsCount = accounts.filter(a => 
    a.isSelected && 
    a.sessionString && 
    a.apiId && 
    a.apiHash &&
    a.status !== "banned"
  ).length;

  const selectedCount = accounts.filter(a => a.isSelected).length;

  if (selectedCount === 0) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          لا توجد حسابات محددة. حدد الحسابات التي تريد تشغيلها من قائمة الحسابات.
        </AlertDescription>
      </Alert>
    );
  }

  if (validAccountsCount === 0) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          الحسابات المحددة ({selectedCount}) لا تحتوي على بيانات جلسة صحيحة. 
          تأكد من استخراج الجلسات أولاً.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleForceRestart} className="w-full">
        <RefreshCw className="w-4 h-4 mr-2" />
        إعادة تشغيل المراقبة ({validAccountsCount} حساب)
      </Button>
      {validAccountsCount < selectedCount && (
        <p className="text-xs text-muted-foreground">
          {selectedCount - validAccountsCount} حساب لا يحتوي على بيانات جلسة
        </p>
      )}
    </div>
  );
}