import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Member } from "@/components/MembersList";
import type { TelegramAccount, LogEntry } from "@/pages/Index";

interface AutoAddSettings {
  targetGroup: string;
  sourceGroup: string;
  membersPerBatch: number;
  delayMin: number;
  delayMax: number;
  delayBetweenBatches: number; // seconds between extraction batches
  cooldownAfterFlood: number;
}

interface UseAutoAddMembersProps {
  accounts: TelegramAccount[];
  settings: AutoAddSettings;
  addLog: (type: LogEntry["type"], message: string, accountPhone?: string) => void;
  onUpdateProgress: (progress: { current: number; total: number; batch: number }) => void;
  onMembersExtracted: (members: Member[]) => void;
  onUpdateMemberStatus: (
    memberId: string,
    status: Member["status"],
    errorMessage?: string
  ) => void;
  onUpdateAccountStatus?: (
    accountId: string,
    status: TelegramAccount["status"],
    statusMessage?: string
  ) => void;
  onOperationStart: () => void;
  onOperationEnd: () => void;
  onComplete: (stats: { totalAdded: number; totalFailed: number; totalSkipped: number }) => void;
}

export function useAutoAddMembers({
  accounts,
  settings,
  addLog,
  onUpdateProgress,
  onMembersExtracted,
  onUpdateMemberStatus,
  onUpdateAccountStatus,
  onOperationStart,
  onOperationEnd,
  onComplete,
}: UseAutoAddMembersProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentBatch, setCurrentBatch] = useState(0);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const processedUserIdsRef = useRef<Set<string>>(new Set());
  const statsRef = useRef({ totalAdded: 0, totalFailed: 0, totalSkipped: 0 });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const getRandomDelay = () => {
    return Math.floor(Math.random() * (settings.delayMax - settings.delayMin + 1)) + settings.delayMin;
  };

  const extractFloodWaitSeconds = (errorMsg: string): number => {
    const match = errorMsg.match(/FLOOD_WAIT[_\s]*(\d+)/i) || errorMsg.match(/(\d+)\s*ثانية/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return settings.cooldownAfterFlood;
  };

  // Send browser notification
  const sendNotification = (title: string, body: string) => {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, { body, icon: "/favicon.ico" });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            new Notification(title, { body, icon: "/favicon.ico" });
          }
        });
      }
    }
  };

  // Join a group with an account
  const joinGroupWithAccount = async (
    account: TelegramAccount,
    groupLink: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "joinGroup",
          sessionString: account.sessionString,
          groupLink: groupLink,
          apiId: account.apiId,
          apiHash: account.apiHash,
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data?.success || data?.error?.includes("USER_ALREADY_PARTICIPANT")) {
        return { success: true };
      }

      return { success: false, error: data?.error };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "خطأ غير متوقع" };
    }
  };

  // Extract members from source group
  const extractMembers = async (
    account: TelegramAccount,
    offset: number = 0
  ): Promise<{ members: Member[]; hasMore: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "getGroupMembers",
          sessionString: account.sessionString,
          groupLink: settings.sourceGroup,
          apiId: account.apiId,
          apiHash: account.apiHash,
          limit: settings.membersPerBatch,
          offset: offset,
        },
      });

      if (error) {
        return { members: [], hasMore: false, error: error.message };
      }

      if (data?.success && data?.members) {
        const members: Member[] = data.members
          .filter((m: any) => !processedUserIdsRef.current.has(String(m.id)))
          .map((m: any) => ({
            id: crypto.randomUUID(),
            oderId: String(m.id),
            username: m.username || "",
            firstName: m.firstName || "",
            lastName: m.lastName || "",
            phone: m.phone || "",
            isSelected: true,
            status: "pending" as const,
          }));

        // Mark these as processed
        data.members.forEach((m: any) => {
          processedUserIdsRef.current.add(String(m.id));
        });

        return {
          members,
          hasMore: data.members.length >= settings.membersPerBatch,
        };
      }

      return { members: [], hasMore: false, error: data?.error };
    } catch (err) {
      return { members: [], hasMore: false, error: err instanceof Error ? err.message : "خطأ" };
    }
  };

  // Add a single member
  const addMember = async (
    member: Member,
    account: TelegramAccount
  ): Promise<{ success: boolean; floodWait?: number; skip?: boolean; error?: string }> => {
    try {
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
        return { success: false, error: error.message };
      }

      if (data?.success) {
        return { success: true };
      }

      const errorMsg = data?.error || "";

      // Flood wait
      if (errorMsg.toLowerCase().includes("flood") || errorMsg.includes("تم تجاوز الحد")) {
        const waitSeconds = extractFloodWaitSeconds(errorMsg);
        return { success: false, floodWait: waitSeconds, error: errorMsg };
      }

      // Skippable errors
      if (
        errorMsg.includes("USER_CHANNELS_TOO_MUCH") ||
        errorMsg.includes("500 مجموعة") ||
        errorMsg.includes("USER_PRIVACY_RESTRICTED") ||
        errorMsg.includes("خصوصية") ||
        errorMsg.includes("موجود مسبقاً") ||
        errorMsg.includes("USER_ALREADY_PARTICIPANT")
      ) {
        return { success: false, skip: true, error: errorMsg };
      }

      return { success: false, error: errorMsg };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "خطأ" };
    }
  };

  const startAutoAdd = useCallback(async () => {
    const activeAccounts = accounts.filter((a) => a.isSelected && a.status === "connected" && a.sessionString);

    if (activeAccounts.length === 0) {
      addLog("error", "لا يوجد حسابات متصلة");
      return;
    }

    if (!settings.sourceGroup.trim() || !settings.targetGroup.trim()) {
      addLog("error", "يرجى تحديد المجموعة المصدر والمستهدفة");
      return;
    }

    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    setIsRunning(true);
    abortRef.current = false;
    pauseRef.current = false;
    processedUserIdsRef.current.clear();
    statsRef.current = { totalAdded: 0, totalFailed: 0, totalSkipped: 0 };
    setCurrentBatch(0);
    onOperationStart();

    // Step 1: Join groups
    addLog("info", "جاري انضمام الحسابات للمجموعات...");
    for (const account of activeAccounts) {
      if (abortRef.current) break;
      
      for (const group of [settings.sourceGroup, settings.targetGroup]) {
        if (abortRef.current) break;
        const result = await joinGroupWithAccount(account, group);
        if (!result.success) {
          addLog("warning", `${account.phone} - فشل الانضمام: ${result.error}`);
        }
        await sleep(2000);
      }
    }

    if (abortRef.current) {
      setIsRunning(false);
      onOperationEnd();
      return;
    }

    // Main loop: Extract → Add → Repeat
    let batchNumber = 0;
    let offset = 0;
    let hasMoreMembers = true;
    let accountIndex = 0;

    while (hasMoreMembers && !abortRef.current) {
      // Check pause
      while (pauseRef.current && !abortRef.current) {
        await sleep(500);
      }
      if (abortRef.current) break;

      batchNumber++;
      setCurrentBatch(batchNumber);
      addLog("info", `=== الدفعة ${batchNumber} ===`);

      // Get next available account for extraction
      const extractAccount = activeAccounts[accountIndex % activeAccounts.length];
      
      addLog("info", `جاري استخراج الأعضاء (offset: ${offset})...`);
      const extractResult = await extractMembers(extractAccount, offset);

      if (extractResult.error) {
        addLog("error", `فشل الاستخراج: ${extractResult.error}`);
        // Try next account
        accountIndex++;
        if (accountIndex >= activeAccounts.length * 2) {
          addLog("error", "فشل الاستخراج من جميع الحسابات");
          break;
        }
        await sleep(10000);
        continue;
      }

      const members = extractResult.members;
      hasMoreMembers = extractResult.hasMore;
      offset += settings.membersPerBatch;

      if (members.length === 0) {
        if (hasMoreMembers) {
          addLog("info", "لا يوجد أعضاء جدد في هذه الدفعة، متابعة...");
          continue;
        } else {
          addLog("success", "تم الانتهاء من جميع الأعضاء!");
          break;
        }
      }

      addLog("info", `تم استخراج ${members.length} عضو جديد`);
      onMembersExtracted(members);

      // Add members
      let batchAdded = 0;
      let batchFailed = 0;
      let batchSkipped = 0;
      let currentAccountIdx = 0;

      for (let i = 0; i < members.length && !abortRef.current; i++) {
        // Check pause
        while (pauseRef.current && !abortRef.current) {
          await sleep(500);
        }
        if (abortRef.current) break;

        const member = members[i];
        
        // Skip members without username
        if (!member.username?.trim()) {
          onUpdateMemberStatus(member.id, "failed", "لا يملك username");
          batchSkipped++;
          statsRef.current.totalSkipped++;
          continue;
        }

        const account = activeAccounts[currentAccountIdx % activeAccounts.length];
        
        addLog("info", `إضافة: ${member.username}`, account.phone);
        const result = await addMember(member, account);

        if (result.success) {
          onUpdateMemberStatus(member.id, "added");
          batchAdded++;
          statsRef.current.totalAdded++;
          addLog("success", `تمت إضافة: ${member.username}`, account.phone);
        } else if (result.floodWait) {
          onUpdateMemberStatus(member.id, "failed", result.error);
          batchFailed++;
          statsRef.current.totalFailed++;
          addLog("warning", `Flood - انتظار ${result.floodWait} ثانية`, account.phone);
          onUpdateAccountStatus?.(account.id, "flood", `انتظار ${result.floodWait}s`);
          
          // Wait for flood
          await sleep(result.floodWait * 1000);
          onUpdateAccountStatus?.(account.id, "connected");
          
          // Rotate to next account
          currentAccountIdx++;
        } else if (result.skip) {
          onUpdateMemberStatus(member.id, "failed", result.error);
          batchSkipped++;
          statsRef.current.totalSkipped++;
          addLog("info", `تخطي: ${member.username} - ${result.error}`);
        } else {
          onUpdateMemberStatus(member.id, "failed", result.error);
          batchFailed++;
          statsRef.current.totalFailed++;
          addLog("error", `فشل: ${member.username} - ${result.error}`);
        }

        onUpdateProgress({
          current: i + 1,
          total: members.length,
          batch: batchNumber,
        });

        // Delay between adds
        const delay = getRandomDelay();
        await sleep(delay * 1000);
        
        // Rotate accounts every few members
        if ((i + 1) % 5 === 0) {
          currentAccountIdx++;
        }
      }

      addLog("info", `الدفعة ${batchNumber}: ${batchAdded} نجاح، ${batchFailed} فشل، ${batchSkipped} تخطي`);

      // Delay between batches
      if (hasMoreMembers && !abortRef.current) {
        addLog("info", `انتظار ${settings.delayBetweenBatches} ثانية قبل الدفعة التالية...`);
        await sleep(settings.delayBetweenBatches * 1000);
      }
    }

    // Complete
    const finalStats = statsRef.current;
    setIsRunning(false);
    setIsPaused(false);
    onOperationEnd();

    const message = `اكتملت العملية! الإجمالي: ${finalStats.totalAdded} نجاح، ${finalStats.totalFailed} فشل، ${finalStats.totalSkipped} تخطي`;
    addLog("success", message);
    
    // Send notification
    sendNotification("🎉 اكتملت العملية!", message);
    
    onComplete(finalStats);
  }, [accounts, settings, addLog, onUpdateProgress, onMembersExtracted, onUpdateMemberStatus, onUpdateAccountStatus, onOperationStart, onOperationEnd, onComplete]);

  const pauseAutoAdd = useCallback(() => {
    pauseRef.current = true;
    setIsPaused(true);
    addLog("warning", "تم إيقاف العملية مؤقتاً");
  }, [addLog]);

  const resumeAutoAdd = useCallback(() => {
    pauseRef.current = false;
    setIsPaused(false);
    addLog("info", "تم استئناف العملية");
  }, [addLog]);

  const stopAutoAdd = useCallback(() => {
    abortRef.current = true;
    pauseRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
    addLog("warning", "تم إيقاف العملية");
  }, [addLog]);

  return {
    isRunning,
    isPaused,
    currentBatch,
    startAutoAdd,
    pauseAutoAdd,
    resumeAutoAdd,
    stopAutoAdd,
  };
}
