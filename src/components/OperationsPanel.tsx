import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  LogIn,
  Users,
  UserPlus,
  Loader2,
  CheckCircle,
  ArrowDown,
  Settings,
} from "lucide-react";
import type { TelegramAccount, LogEntry } from "@/pages/Index";
import type { Member } from "./MembersList";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OperationsPanelProps {
  accounts: TelegramAccount[];
  selectedAccounts: number;
  isRunning: boolean;
  addLog: (type: LogEntry["type"], message: string, accountPhone?: string) => void;
  onOperationStart?: () => void;
  onOperationEnd?: () => void;
  onMembersExtracted?: (members: Member[]) => void;
}

type WorkflowStep = "idle" | "joining" | "joined" | "extracting" | "extracted" | "adding" | "complete";

export function OperationsPanel({
  accounts,
  selectedAccounts,
  isRunning,
  addLog,
  onOperationStart,
  onOperationEnd,
  onMembersExtracted,
}: OperationsPanelProps) {
  const [sourceGroup, setSourceGroup] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("idle");
  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [extractedMembers, setExtractedMembers] = useState<Member[]>([]);
  const [delaySeconds, setDelaySeconds] = useState(30);

  const selectedAccountsList = accounts.filter((a) => a.isSelected);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Step 1: Join accounts to source group
  const handleJoinGroup = async () => {
    if (!sourceGroup.trim()) {
      toast.error("يرجى إدخال رابط المجموعة المصدر");
      return;
    }
    if (selectedAccountsList.length === 0) {
      toast.error("يرجى تحديد حساب واحد على الأقل");
      return;
    }

    setIsExecuting(true);
    setWorkflowStep("joining");
    setProgress({ current: 0, total: selectedAccountsList.length });
    onOperationStart?.();

    addLog("info", `بدء انضمام ${selectedAccountsList.length} حساب للمجموعة...`);

    let successCount = 0;
    for (let i = 0; i < selectedAccountsList.length; i++) {
      const account = selectedAccountsList[i];
      
      try {
        if (!account.sessionString) {
          addLog("warning", `الحساب ${account.phone} غير متصل`, account.phone);
          continue;
        }

        const { data, error } = await supabase.functions.invoke("telegram-auth", {
          body: {
            action: "joinGroup",
            sessionString: account.sessionString,
            groupLink: sourceGroup,
            apiId: account.apiId,
            apiHash: account.apiHash,
          },
        });

        if (error || data?.error) {
          addLog("error", `فشل انضمام ${account.phone}: ${error?.message || data?.error}`, account.phone);
        } else {
          successCount++;
          addLog("success", `تم انضمام ${account.phone} بنجاح`, account.phone);
        }
      } catch (err) {
        addLog("error", `خطأ في الانضمام: ${account.phone}`, account.phone);
      }

      setProgress({ current: i + 1, total: selectedAccountsList.length });

      if (i < selectedAccountsList.length - 1) {
        await sleep(delaySeconds * 1000);
      }
    }

    addLog("success", `اكتمل الانضمام: ${successCount}/${selectedAccountsList.length} نجاح`);
    toast.success(`تم انضمام ${successCount} حساب بنجاح`);
    
    setWorkflowStep("joined");
    setIsExecuting(false);
    onOperationEnd?.();
  };

  // Step 2: Extract members from the group
  const handleExtractMembers = async () => {
    if (selectedAccountsList.length === 0) {
      toast.error("يرجى تحديد حساب واحد على الأقل");
      return;
    }

    const account = selectedAccountsList[0]; // Use first selected account
    if (!account.sessionString) {
      toast.error("الحساب غير متصل");
      return;
    }

    setIsExecuting(true);
    setWorkflowStep("extracting");
    addLog("info", `جاري استخراج الأعضاء من المجموعة...`);

    try {
      const allMembers: any[] = [];
      const seenIds = new Set<string>();
      const limit = 200;
      let offset = 0;
      let hasMore = true;
      let safetyBatches = 0;

      while (hasMore) {
        safetyBatches++;
        if (safetyBatches > 500) {
          throw new Error("توقف أمان: عدد دفعات كبير جداً");
        }

        const { data, error } = await supabase.functions.invoke("telegram-auth", {
          body: {
            action: "getGroupMembers",
            sessionString: account.sessionString,
            groupLink: sourceGroup,
            apiId: account.apiId,
            apiHash: account.apiHash,
            limit,
            offset,
          },
        });

        if (error || data?.error) {
          throw new Error(error?.message || data?.error);
        }

        const batch = Array.isArray(data?.members) ? data.members : [];
        for (const m of batch) {
          const id = m?.id?.toString?.() ?? String(m?.id ?? "");
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          allMembers.push(m);
        }

        hasMore = Boolean(data?.hasMore) && batch.length > 0;
        offset = typeof data?.nextOffset === "number" ? data.nextOffset : offset + batch.length;

        await sleep(1200);
      }

      const members: Member[] = allMembers.map((m: any, index: number) => ({
        id: crypto.randomUUID(),
        oderId: m.id?.toString() || index.toString(),
        username: m.username || "",
        firstName: m.firstName || m.first_name || "",
        lastName: m.lastName || m.last_name || "",
        status: "pending" as const,
        isSelected: true,
      }));

      setExtractedMembers(members);
      onMembersExtracted?.(members);
      
      addLog("success", `تم استخراج ${members.length} عضو من المجموعة`);
      toast.success(`تم استخراج ${members.length} عضو`);
      
      setWorkflowStep("extracted");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "خطأ غير معروف";
      addLog("error", `فشل استخراج الأعضاء: ${errorMessage}`);
      toast.error(`فشل الاستخراج: ${errorMessage}`);
      setWorkflowStep("joined");
    }

    setIsExecuting(false);
  };

  // Step 3: Add extracted members to target group
  const handleAddMembersToTarget = async () => {
    if (!targetGroup.trim()) {
      toast.error("يرجى إدخال رابط المجموعة المستهدفة");
      return;
    }
    if (extractedMembers.length === 0) {
      toast.error("لا يوجد أعضاء للإضافة");
      return;
    }
    if (selectedAccountsList.length === 0) {
      toast.error("يرجى تحديد حساب واحد على الأقل");
      return;
    }

    setIsExecuting(true);
    setWorkflowStep("adding");
    setProgress({ current: 0, total: extractedMembers.length });
    onOperationStart?.();

    addLog("info", `بدء إضافة ${extractedMembers.length} عضو للمجموعة المستهدفة...`);

    let successCount = 0;
    let accountIndex = 0;

    for (let i = 0; i < extractedMembers.length; i++) {
      const member = extractedMembers[i];
      const account = selectedAccountsList[accountIndex % selectedAccountsList.length];

      if (!account.sessionString) {
        accountIndex++;
        continue;
      }

      try {
        const { data, error } = await supabase.functions.invoke("telegram-auth", {
          body: {
            action: "addMemberToGroup",
            sessionString: account.sessionString,
            groupLink: targetGroup,
            userId: member.oderId,
            username: member.username,
            apiId: account.apiId,
            apiHash: account.apiHash,
          },
        });

        if (error || data?.error) {
          addLog("error", `فشل إضافة @${member.username || member.oderId}`, account.phone);
        } else {
          successCount++;
          addLog("success", `تمت إضافة @${member.username || member.firstName}`, account.phone);
        }
      } catch (err) {
        addLog("error", `خطأ في الإضافة: @${member.username}`, account.phone);
      }

      setProgress({ current: i + 1, total: extractedMembers.length });

      // Rotate accounts every few members
      if ((i + 1) % 5 === 0) {
        accountIndex++;
      }

      if (i < extractedMembers.length - 1) {
        await sleep(delaySeconds * 1000);
      }
    }

    addLog("success", `اكتملت الإضافة: ${successCount}/${extractedMembers.length} نجاح`);
    toast.success(`تمت إضافة ${successCount} عضو بنجاح`);
    
    setWorkflowStep("complete");
    setIsExecuting(false);
    onOperationEnd?.();
  };

  // Reset workflow
  const handleReset = () => {
    setWorkflowStep("idle");
    setSourceGroup("");
    setTargetGroup("");
    setExtractedMembers([]);
    setProgress({ current: 0, total: 0 });
  };

  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="w-4 h-4" />
          سحب الأعضاء ونقلهم
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto space-y-4">
        {/* Step Indicator */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className={workflowStep !== "idle" ? "text-primary font-medium" : ""}>
            1. انضمام
          </span>
          <ArrowDown className="w-3 h-3 rotate-[-90deg]" />
          <span className={["extracted", "adding", "complete"].includes(workflowStep) ? "text-primary font-medium" : ""}>
            2. استخراج
          </span>
          <ArrowDown className="w-3 h-3 rotate-[-90deg]" />
          <span className={workflowStep === "complete" ? "text-primary font-medium" : ""}>
            3. إضافة
          </span>
        </div>

        <Separator />

        {/* Source Group Input */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <LogIn className="w-4 h-4" />
            المجموعة المصدر (للانضمام والسحب منها)
          </Label>
          <Input
            placeholder="https://t.me/groupname أو @groupname"
            value={sourceGroup}
            onChange={(e) => setSourceGroup(e.target.value)}
            disabled={workflowStep !== "idle"}
            dir="ltr"
            className="text-left"
          />
        </div>

        {/* Step 1: Join Button */}
        <Button
          onClick={handleJoinGroup}
          disabled={isExecuting || selectedAccounts === 0 || !sourceGroup.trim() || workflowStep !== "idle"}
          className="w-full gap-2"
          variant={workflowStep === "joined" ? "outline" : "default"}
        >
          {workflowStep === "joining" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : workflowStep !== "idle" ? (
            <CheckCircle className="w-4 h-4 text-primary" />
          ) : (
            <LogIn className="w-4 h-4" />
          )}
          {workflowStep === "joining" 
            ? "جاري الانضمام..." 
            : workflowStep !== "idle" 
            ? "تم الانضمام ✓" 
            : `انضمام ${selectedAccounts} حساب للمجموعة`}
        </Button>

        {/* Step 2: Extract Button */}
        {["joined", "extracted", "adding", "complete"].includes(workflowStep) && (
          <Button
            onClick={handleExtractMembers}
            disabled={isExecuting || workflowStep === "extracting" || ["extracted", "adding", "complete"].includes(workflowStep)}
            className="w-full gap-2"
            variant={["extracted", "adding", "complete"].includes(workflowStep) ? "outline" : "secondary"}
          >
            {workflowStep === "extracting" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : ["extracted", "adding", "complete"].includes(workflowStep) ? (
              <CheckCircle className="w-4 h-4 text-primary" />
            ) : (
              <Users className="w-4 h-4" />
            )}
            {workflowStep === "extracting" 
              ? "جاري الاستخراج..." 
              : ["extracted", "adding", "complete"].includes(workflowStep)
              ? `تم استخراج ${extractedMembers.length} عضو ✓`
              : "استخراج أعضاء المجموعة"}
          </Button>
        )}

        {/* Target Group Input */}
        {["extracted", "adding", "complete"].includes(workflowStep) && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              المجموعة المستهدفة (لإضافة الأعضاء إليها)
            </Label>
            <Input
              placeholder="https://t.me/targetgroup أو @targetgroup"
              value={targetGroup}
              onChange={(e) => setTargetGroup(e.target.value)}
              disabled={workflowStep === "adding" || workflowStep === "complete"}
              dir="ltr"
              className="text-left"
            />
          </div>
        )}

        {/* Step 3: Add Members Button */}
        {["extracted", "adding", "complete"].includes(workflowStep) && (
          <Button
            onClick={handleAddMembersToTarget}
            disabled={isExecuting || !targetGroup.trim() || workflowStep === "complete"}
            className="w-full gap-2"
            variant={workflowStep === "complete" ? "outline" : "default"}
          >
            {workflowStep === "adding" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : workflowStep === "complete" ? (
              <CheckCircle className="w-4 h-4 text-primary" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            {workflowStep === "adding" 
              ? "جاري الإضافة..." 
              : workflowStep === "complete"
              ? "تمت الإضافة بنجاح ✓"
              : `إضافة ${extractedMembers.length} عضو للمجموعة`}
          </Button>
        )}

        {/* Progress Bar */}
        {isExecuting && (
          <div className="p-4 rounded-lg bg-accent/50 border space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">التقدم:</span>
              <span className="font-medium">
                {progress.current} / {progress.total}
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}

        {/* Delay Setting */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            التأخير بين العمليات (ثانية)
          </Label>
          <Input
            type="number"
            value={delaySeconds}
            onChange={(e) => setDelaySeconds(Number(e.target.value))}
            min={5}
            max={120}
            disabled={isExecuting}
          />
        </div>

        {/* Reset Button */}
        {workflowStep === "complete" && (
          <Button onClick={handleReset} variant="outline" className="w-full">
            بدء عملية جديدة
          </Button>
        )}

        {/* Status */}
        <div className="p-4 rounded-lg bg-muted/50 border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">الحسابات المحددة:</span>
            <span className="font-medium">{selectedAccounts}</span>
          </div>
          {extractedMembers.length > 0 && (
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-muted-foreground">الأعضاء المستخرجون:</span>
              <span className="font-medium">{extractedMembers.length}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
