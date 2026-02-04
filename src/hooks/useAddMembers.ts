import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Member } from "@/components/MembersList";
import type { TelegramAccount, LogEntry } from "@/pages/Index";

interface AddSettings {
  targetGroup: string;
  sourceGroup: string;
  membersPerAccount: number;
  delayMin: number;
  delayMax: number;
  pauseAfterBan: boolean;
  skipExisting: boolean;
  rotateAccounts: boolean;
  maxRetries: number;
  cooldownAfterFlood: number;
}

interface UseAddMembersProps {
  members: Member[];
  accounts: TelegramAccount[];
  settings: AddSettings;
  addLog: (type: LogEntry["type"], message: string, accountPhone?: string) => void;
  onUpdateProgress: (progress: { current: number; total: number }) => void;
  onUpdateMemberStatus: (
    memberId: string,
    status: Member["status"],
    errorMessage?: string
  ) => void;
  onOperationStart: () => void;
  onOperationEnd: () => void;
}

export function useAddMembers({
  members,
  accounts,
  settings,
  addLog,
  onUpdateProgress,
  onUpdateMemberStatus,
  onOperationStart,
  onOperationEnd,
}: UseAddMembersProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const getRandomDelay = () => {
    return Math.floor(Math.random() * (settings.delayMax - settings.delayMin + 1)) + settings.delayMin;
  };

  const startAdding = useCallback(async () => {
    const selectedMembers = members.filter((m) => m.isSelected && m.status === "pending");
    const activeAccounts = accounts.filter((a) => a.isSelected && a.status === "connected" && a.sessionString);

    if (selectedMembers.length === 0) {
      addLog("warning", "لا يوجد أعضاء محددون للإضافة");
      return;
    }

    if (activeAccounts.length === 0) {
      addLog("error", "لا يوجد حسابات متصلة للإضافة");
      return;
    }

    if (!settings.targetGroup.trim()) {
      addLog("error", "يرجى تحديد المجموعة المستهدفة");
      return;
    }

    setIsRunning(true);
    abortRef.current = false;
    pauseRef.current = false;
    onOperationStart();

    addLog("info", `بدء إضافة ${selectedMembers.length} عضو إلى ${settings.targetGroup}`);
    onUpdateProgress({ current: 0, total: selectedMembers.length });

    let currentAccountIndex = 0;
    let membersAddedByCurrentAccount = 0;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedMembers.length; i++) {
      // Check for abort
      if (abortRef.current) {
        addLog("warning", "تم إيقاف العملية بواسطة المستخدم");
        break;
      }

      // Check for pause
      while (pauseRef.current && !abortRef.current) {
        await sleep(500);
      }

      if (abortRef.current) break;

      const member = selectedMembers[i];
      const account = activeAccounts[currentAccountIndex];

      // Rotate account if needed
      if (settings.rotateAccounts && membersAddedByCurrentAccount >= settings.membersPerAccount) {
        currentAccountIndex = (currentAccountIndex + 1) % activeAccounts.length;
        membersAddedByCurrentAccount = 0;
        addLog("info", `تبديل للحساب: ${activeAccounts[currentAccountIndex].phone}`);
      }

      try {
        // Telegram often cannot invite users by numeric ID unless the account has an entity cached.
        // In practice, inviting by username is the most reliable.
        if (!member.username || !member.username.trim()) {
          const msg = "لا يمكن إضافة هذا العضو لأنه لا يملك username (يوزر).";
          onUpdateMemberStatus(member.id, "failed", msg);
          failCount++;
          addLog("warning", msg, account.phone);
          // still advance progress + delays below
          membersAddedByCurrentAccount++;
          onUpdateProgress({ current: i + 1, total: selectedMembers.length });

          if (i < selectedMembers.length - 1) {
            const delay = getRandomDelay();
            addLog("info", `انتظار ${delay} ثانية قبل الإضافة التالية...`);
            await sleep(delay * 1000);
          }
          continue;
        }

        addLog("info", `جاري إضافة: ${member.username || member.firstName || member.oderId}`, account.phone);

        const { data, error } = await supabase.functions.invoke("telegram-auth", {
          body: {
            action: "addMemberToGroup",
            sessionString: account.sessionString,
            groupLink: settings.targetGroup,
            sourceGroup: settings.sourceGroup,
            userId: member.oderId,
            username: member.username,
            apiId: account.apiId,
            apiHash: account.apiHash,
          },
        });

        if (error) {
          throw new Error(error.message || "فشل في الاتصال بالخادم");
        }

        if (data?.success) {
          onUpdateMemberStatus(member.id, "added");
          successCount++;
          addLog("success", `تمت إضافة: ${member.username || member.firstName}`, account.phone);
        } else {
          const errorMsg = data?.error || "خطأ غير معروف";
          
          // Check for flood wait
          if (errorMsg.toLowerCase().includes("flood") || errorMsg.includes("FLOOD_WAIT")) {
            addLog("warning", `تحذير Flood - انتظار ${settings.cooldownAfterFlood} ثانية`, account.phone);
            await sleep(settings.cooldownAfterFlood * 1000);
          }
          
          // Check for ban
          if (settings.pauseAfterBan && (errorMsg.includes("banned") || errorMsg.includes("BAN"))) {
            addLog("error", `الحساب محظور: ${account.phone} - إيقاف العملية`);
            break;
          }

          onUpdateMemberStatus(member.id, "failed", errorMsg);
          failCount++;
          addLog("error", `فشل إضافة ${member.username || member.firstName}: ${errorMsg}`, account.phone);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "خطأ غير متوقع";
        onUpdateMemberStatus(member.id, "failed", errorMessage);
        failCount++;
        addLog("error", `خطأ: ${errorMessage}`, account.phone);
      }

      membersAddedByCurrentAccount++;
      onUpdateProgress({ current: i + 1, total: selectedMembers.length });

      // Delay between operations
      if (i < selectedMembers.length - 1) {
        const delay = getRandomDelay();
        addLog("info", `انتظار ${delay} ثانية قبل الإضافة التالية...`);
        await sleep(delay * 1000);
      }
    }

    setIsRunning(false);
    setIsPaused(false);
    onOperationEnd();
    addLog("success", `انتهت العملية: ${successCount} نجاح، ${failCount} فشل`);
    onUpdateProgress({ current: 0, total: 0 });
  }, [members, accounts, settings, addLog, onUpdateProgress, onUpdateMemberStatus, onOperationStart, onOperationEnd]);

  const pauseAdding = useCallback(() => {
    pauseRef.current = true;
    setIsPaused(true);
    addLog("warning", "تم إيقاف العملية مؤقتاً");
  }, [addLog]);

  const resumeAdding = useCallback(() => {
    pauseRef.current = false;
    setIsPaused(false);
    addLog("info", "تم استئناف العملية");
  }, [addLog]);

  const stopAdding = useCallback(() => {
    abortRef.current = true;
    pauseRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
  }, []);

  return {
    isRunning,
    isPaused,
    startAdding,
    pauseAdding,
    resumeAdding,
    stopAdding,
  };
}
