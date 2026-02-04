import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Settings, UserPlus, LogIn, LogOut, Clock, Users, Copy, ArrowLeftRight, Play, Loader2 } from "lucide-react";
import type { TelegramAccount, LogEntry } from "@/pages/Index";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OperationsPanelProps {
  accounts: TelegramAccount[];
  selectedAccounts: number;
  isRunning: boolean;
  addLog: (type: LogEntry["type"], message: string, accountPhone?: string) => void;
  onOperationStart?: () => void;
  onOperationEnd?: () => void;
}

interface GroupOperationResult {
  phone: string;
  success: boolean;
  error?: string;
}

export function OperationsPanel({
  accounts,
  selectedAccounts,
  isRunning,
  addLog,
  onOperationStart,
  onOperationEnd,
}: OperationsPanelProps) {
  const [operationType, setOperationType] = useState("join-public");
  const [groupLink, setGroupLink] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);
  const [accountsPerBatch, setAccountsPerBatch] = useState(5);
  
  const [isExecuting, setIsExecuting] = useState(false);
  const [operationProgress, setOperationProgress] = useState({ current: 0, total: 0 });
  const [operationResults, setOperationResults] = useState<GroupOperationResult[]>([]);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferTargetGroup, setTransferTargetGroup] = useState("");

  const selectedAccountsList = accounts.filter((a) => a.isSelected);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const getRandomDelay = () => {
    return Math.floor(Math.random() * (delayMax - delayMin + 1) + delayMin) * 1000;
  };

  const executeGroupOperation = async (
    account: TelegramAccount,
    operation: string,
    group: string
  ): Promise<GroupOperationResult> => {
    try {
      // Check if account has session string
      if (!account.sessionString) {
        return { 
          phone: account.phone, 
          success: false, 
          error: "الحساب غير متصل - يرجى استخراج الجلسة أولاً" 
        };
      }

      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: operation,
          sessionString: account.sessionString,
          groupLink: group,
          apiId: account.apiId,
          apiHash: account.apiHash,
          phone: account.phone,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return { phone: account.phone, success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "خطأ غير معروف";
      return { phone: account.phone, success: false, error: errorMessage };
    }
  };

  const handleStartOperation = async () => {
    if (!groupLink.trim()) {
      toast.error("يرجى إدخال رابط المجموعة");
      return;
    }

    if (selectedAccountsList.length === 0) {
      toast.error("يرجى تحديد حساب واحد على الأقل");
      return;
    }

    setIsExecuting(true);
    setOperationResults([]);
    setOperationProgress({ current: 0, total: selectedAccountsList.length });
    onOperationStart?.();

    const actionMap: Record<string, string> = {
      "join-public": "joinGroup",
      "join-private": "joinPrivateGroup",
      "leave-public": "leaveGroup",
      "leave-private": "leaveGroup",
    };

    const action = actionMap[operationType] || "joinGroup";
    const operationName = operationType.includes("join") ? "الانضمام" : "المغادرة";
    const results: GroupOperationResult[] = [];

    addLog("info", `بدء عملية ${operationName} لـ ${selectedAccountsList.length} حساب...`);

    for (let i = 0; i < selectedAccountsList.length; i++) {
      const account = selectedAccountsList[i];
      
      addLog("info", `جاري ${operationName} للحساب: ${account.phone}`, account.phone);
      
      const result = await executeGroupOperation(account, action, groupLink);
      results.push(result);

      if (result.success) {
        addLog("success", `تم ${operationName} بنجاح: ${account.phone}`, account.phone);
      } else {
        addLog("error", `فشل ${operationName}: ${account.phone} - ${result.error}`, account.phone);
      }

      setOperationProgress({ current: i + 1, total: selectedAccountsList.length });
      setOperationResults([...results]);

      // Add delay between operations (except for last one)
      if (i < selectedAccountsList.length - 1) {
        const delay = getRandomDelay();
        addLog("info", `انتظار ${Math.round(delay / 1000)} ثانية...`);
        await sleep(delay);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    addLog(
      successCount > 0 ? "success" : "error",
      `اكتملت العملية: ${successCount} نجاح، ${failCount} فشل`
    );

    toast.success(`اكتملت العملية: ${successCount}/${results.length} نجاح`);

    setIsExecuting(false);
    onOperationEnd?.();
  };

  const handleCopySelectedPhones = () => {
    if (selectedAccountsList.length === 0) {
      toast.error("لا توجد حسابات محددة للنسخ");
      return;
    }

    const phones = selectedAccountsList.map((a) => a.phone).join("\n");
    navigator.clipboard.writeText(phones);
    toast.success(`تم نسخ ${selectedAccountsList.length} رقم هاتف`);
    addLog("success", `تم نسخ ${selectedAccountsList.length} رقم للحافظة`);
  };

  const handleTransferToGroup = async () => {
    if (!transferTargetGroup.trim()) {
      toast.error("يرجى إدخال رابط المجموعة المستهدفة");
      return;
    }

    if (selectedAccountsList.length === 0) {
      toast.error("يرجى تحديد حساب واحد على الأقل");
      return;
    }

    setShowTransferDialog(false);
    setIsExecuting(true);
    setOperationResults([]);
    setOperationProgress({ current: 0, total: selectedAccountsList.length });
    onOperationStart?.();

    const results: GroupOperationResult[] = [];

    addLog("info", `بدء نقل ${selectedAccountsList.length} حساب إلى المجموعة الجديدة...`);

    for (let i = 0; i < selectedAccountsList.length; i++) {
      const account = selectedAccountsList[i];

      addLog("info", `جاري نقل الحساب: ${account.phone}`, account.phone);

      // First, leave current group if specified
      if (groupLink.trim()) {
        addLog("info", `مغادرة المجموعة الحالية...`, account.phone);
        await executeGroupOperation(account, "leaveGroup", groupLink);
        await sleep(2000); // Small delay between leave and join
      }

      // Then join new group
      const result = await executeGroupOperation(account, "joinGroup", transferTargetGroup);
      results.push(result);

      if (result.success) {
        addLog("success", `تم نقل الحساب بنجاح: ${account.phone}`, account.phone);
      } else {
        addLog("error", `فشل نقل الحساب: ${account.phone} - ${result.error}`, account.phone);
      }

      setOperationProgress({ current: i + 1, total: selectedAccountsList.length });
      setOperationResults([...results]);

      if (i < selectedAccountsList.length - 1) {
        const delay = getRandomDelay();
        addLog("info", `انتظار ${Math.round(delay / 1000)} ثانية...`);
        await sleep(delay);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    addLog("success", `اكتمل النقل: ${successCount}/${results.length} نجاح`);
    toast.success(`تم نقل ${successCount} حساب بنجاح`);

    setIsExecuting(false);
    setTransferTargetGroup("");
    onOperationEnd?.();
  };

  const progressPercent =
    operationProgress.total > 0
      ? (operationProgress.current / operationProgress.total) * 100
      : 0;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="w-4 h-4" />
          العمليات
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <Tabs defaultValue="groups" className="h-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="groups">المجموعات</TabsTrigger>
            <TabsTrigger value="settings">الإعدادات</TabsTrigger>
          </TabsList>

          <TabsContent value="groups" className="space-y-4 mt-0">
            {/* Operation Type */}
            <div className="space-y-2">
              <Label>نوع العملية</Label>
              <Select value={operationType} onValueChange={setOperationType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="join-public">
                    <span className="flex items-center gap-2">
                      <LogIn className="w-4 h-4" />
                      الانضمام لمجموعة عامة
                    </span>
                  </SelectItem>
                  <SelectItem value="join-private">
                    <span className="flex items-center gap-2">
                      <LogIn className="w-4 h-4" />
                      الانضمام لمجموعة خاصة
                    </span>
                  </SelectItem>
                  <SelectItem value="leave-public">
                    <span className="flex items-center gap-2">
                      <LogOut className="w-4 h-4" />
                      مغادرة مجموعة عامة
                    </span>
                  </SelectItem>
                  <SelectItem value="leave-private">
                    <span className="flex items-center gap-2">
                      <LogOut className="w-4 h-4" />
                      مغادرة مجموعة خاصة
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Group Link */}
            <div className="space-y-2">
              <Label htmlFor="groupLink">رابط المجموعة</Label>
              <Input
                id="groupLink"
                placeholder="https://t.me/groupname أو @groupname"
                value={groupLink}
                onChange={(e) => setGroupLink(e.target.value)}
                dir="ltr"
                className="text-left"
              />
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={handleStartOperation}
                disabled={isExecuting || selectedAccounts === 0 || !groupLink.trim()}
                className="gap-2"
              >
                {isExecuting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                تنفيذ العملية
              </Button>

              <Button
                variant="outline"
                onClick={handleCopySelectedPhones}
                disabled={selectedAccounts === 0}
                className="gap-2"
              >
                <Copy className="w-4 h-4" />
                نسخ الأرقام
              </Button>
            </div>

            {/* Transfer Button */}
            <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
              <DialogTrigger asChild>
                <Button
                  variant="secondary"
                  className="w-full gap-2"
                  disabled={selectedAccounts === 0 || isExecuting}
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  نقل الحسابات لمجموعة أخرى
                </Button>
              </DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader>
                  <DialogTitle>نقل الحسابات</DialogTitle>
                  <DialogDescription>
                    سيتم نقل {selectedAccounts} حساب إلى المجموعة الجديدة
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>المجموعة الحالية (اختياري - للمغادرة منها)</Label>
                    <Input
                      placeholder="اتركه فارغاً للانضمام فقط"
                      value={groupLink}
                      onChange={(e) => setGroupLink(e.target.value)}
                      dir="ltr"
                      className="text-left"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>المجموعة المستهدفة (للانضمام إليها)</Label>
                    <Input
                      placeholder="https://t.me/newgroup أو @newgroup"
                      value={transferTargetGroup}
                      onChange={(e) => setTransferTargetGroup(e.target.value)}
                      dir="ltr"
                      className="text-left"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowTransferDialog(false)}>
                    إلغاء
                  </Button>
                  <Button onClick={handleTransferToGroup} disabled={!transferTargetGroup.trim()}>
                    بدء النقل
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Progress (when executing) */}
            {isExecuting && (
              <div className="p-4 rounded-lg bg-accent/50 border space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">التقدم:</span>
                  <span className="font-medium">
                    {operationProgress.current} / {operationProgress.total}
                  </span>
                </div>
                <Progress value={progressPercent} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  جاري التنفيذ... يرجى الانتظار
                </p>
              </div>
            )}

            {/* Results Summary */}
            {operationResults.length > 0 && !isExecuting && (
              <div className="p-4 rounded-lg bg-muted/50 border space-y-2">
                <h4 className="text-sm font-medium">نتائج العملية</h4>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-primary">نجاح:</span>
                  <span className="font-medium">
                    {operationResults.filter((r) => r.success).length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-destructive">فشل:</span>
                  <span className="font-medium">
                    {operationResults.filter((r) => !r.success).length}
                  </span>
                </div>
              </div>
            )}

            {/* Status */}
            <div className="p-4 rounded-lg bg-accent/50 border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">الحسابات المحددة:</span>
                <span className="font-medium">{selectedAccounts}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">الحالة:</span>
                <span
                  className={`font-medium ${
                    isExecuting ? "text-green-500" : "text-muted-foreground"
                  }`}
                >
                  {isExecuting ? "قيد التشغيل" : "جاهز"}
                </span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6 mt-0">
            {/* Delay Settings */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <Label>التأخير بين العمليات (ثانية)</Label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">الحد الأدنى</Label>
                  <Input
                    type="number"
                    value={delayMin}
                    onChange={(e) => setDelayMin(Number(e.target.value))}
                    min={5}
                    max={300}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">الحد الأقصى</Label>
                  <Input
                    type="number"
                    value={delayMax}
                    onChange={(e) => setDelayMax(Number(e.target.value))}
                    min={5}
                    max={300}
                  />
                </div>
              </div>
            </div>

            {/* Accounts Per Batch */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <Label>الحسابات لكل دفعة</Label>
                </div>
                <span className="text-sm font-medium">{accountsPerBatch}</span>
              </div>
              <Slider
                value={[accountsPerBatch]}
                onValueChange={(v) => setAccountsPerBatch(v[0])}
                min={1}
                max={20}
                step={1}
              />
            </div>

            {/* Protection Settings */}
            <div className="p-4 rounded-lg bg-accent/30 border space-y-3">
              <h4 className="text-sm font-medium">إعدادات الحماية</h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• إيقاف تلقائي عند الحظر</li>
                <li>• تجاهل الحسابات المقيدة</li>
                <li>• توزيع الحمل على الحسابات</li>
                <li>• تأخير عشوائي بين العمليات</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
