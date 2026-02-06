import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Member } from "@/components/MembersList";
import type { TelegramAccount, LogEntry } from "@/pages/Index";

interface AutoAddSettings {
  targetGroup: string;
  sourceGroups: string[];
  membersPerBatch: number;
  delayMin: number;
  delayMax: number;
  delayBetweenBatches: number;
  cooldownAfterFlood: number;
  infiniteLoop: boolean;
}

export interface SuccessfulMember {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  addedAt: string;
  addedBy: string;
}

interface UseAutoAddMembersProps {
  accounts: TelegramAccount[];
  settings: AutoAddSettings;
  addLog: (type: LogEntry["type"], message: string, accountPhone?: string) => void;
  onUpdateProgress: (progress: { current: number; total: number; batch: number; groupIndex: number; totalGroups: number }) => void;
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
  onComplete: (stats: { totalAdded: number; totalFailed: number; totalSkipped: number; successfulMembers: SuccessfulMember[] }) => void;
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
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [successfulMembers, setSuccessfulMembers] = useState<SuccessfulMember[]>([]);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const processedUserIdsRef = useRef<Set<string>>(new Set()); // Members already attempted
  const addedUserIdsRef = useRef<Set<string>>(new Set()); // Successfully added members
  const statsRef = useRef({ totalAdded: 0, totalFailed: 0, totalSkipped: 0 });
  const successfulMembersRef = useRef<SuccessfulMember[]>([]);
  const loopCountRef = useRef(0);
  const currentAccountIndexRef = useRef(0); // For sequential account rotation

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

  // Get next available account (sequential rotation)
  const getNextAccount = (activeAccounts: TelegramAccount[]): TelegramAccount | null => {
    const availableAccounts = activeAccounts.filter(
      (a) => a.status === "connected" && a.isSelected
    );
    
    if (availableAccounts.length === 0) return null;
    
    const account = availableAccounts[currentAccountIndexRef.current % availableAccounts.length];
    return account;
  };

  // Move to next account in rotation
  const rotateToNextAccount = (activeAccounts: TelegramAccount[]) => {
    const availableCount = activeAccounts.filter(
      (a) => a.status === "connected" && a.isSelected
    ).length;
    
    if (availableCount > 0) {
      currentAccountIndexRef.current = (currentAccountIndexRef.current + 1) % availableCount;
    }
  };

  // Join a group with an account
  const joinGroupWithAccount = async (
    account: TelegramAccount,
    groupLink: string
  ): Promise<{ success: boolean; error?: string; banned?: boolean }> => {
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
        const isBanned = error.message?.toLowerCase().includes("banned") || 
                         error.message?.toLowerCase().includes("محظور");
        return { success: false, error: error.message, banned: isBanned };
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
    sourceGroup: string,
    offset: number = 0
  ): Promise<{ members: Member[]; hasMore: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "getGroupMembers",
          sessionString: account.sessionString,
          groupLink: sourceGroup,
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
    account: TelegramAccount,
    sourceGroup: string
  ): Promise<{ success: boolean; floodWait?: number; skip?: boolean; banned?: boolean; error?: string }> => {
    // Skip if already added (prevent duplicate attempts)
    if (addedUserIdsRef.current.has(member.oderId)) {
      return { success: false, skip: true, error: "تمت إضافته مسبقاً" };
    }

    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "addMemberToGroup",
          sessionString: account.sessionString,
          groupLink: settings.targetGroup,
          sourceGroup: sourceGroup,
          userId: member.oderId,
          username: member.username,
          apiId: account.apiId,
          apiHash: account.apiHash,
        },
      });

      if (error) {
        const isBanned = error.message?.toLowerCase().includes("banned") || 
                         error.message?.toLowerCase().includes("محظور");
        return { success: false, error: error.message, banned: isBanned };
      }

      if (data?.success) {
        // Mark as successfully added
        addedUserIdsRef.current.add(member.oderId);
        
        // Store successful member
        const successMember: SuccessfulMember = {
          id: member.oderId,
          username: member.username,
          firstName: member.firstName,
          lastName: member.lastName,
          addedAt: new Date().toISOString(),
          addedBy: account.phone,
        };
        successfulMembersRef.current.push(successMember);
        setSuccessfulMembers([...successfulMembersRef.current]);
        
        return { success: true };
      }

      const errorMsg = data?.error || "";

      // Check if banned
      if (errorMsg.toLowerCase().includes("banned") || 
          errorMsg.toLowerCase().includes("محظور") ||
          errorMsg.includes("USER_BANNED") ||
          errorMsg.includes("CHAT_WRITE_FORBIDDEN")) {
        return { success: false, banned: true, error: errorMsg };
      }

      // Flood wait
      if (errorMsg.toLowerCase().includes("flood") || errorMsg.includes("تم تجاوز الحد")) {
        const waitSeconds = extractFloodWaitSeconds(errorMsg);
        return { success: false, floodWait: waitSeconds, error: errorMsg };
      }

      // Skippable errors (don't switch account for these)
      if (
        errorMsg.includes("USER_CHANNELS_TOO_MUCH") ||
        errorMsg.includes("500 مجموعة") ||
        errorMsg.includes("USER_PRIVACY_RESTRICTED") ||
        errorMsg.includes("خصوصية") ||
        errorMsg.includes("موجود مسبقاً") ||
        errorMsg.includes("USER_ALREADY_PARTICIPANT")
      ) {
        // Mark as processed to avoid re-trying
        addedUserIdsRef.current.add(member.oderId);
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

    const sourceGroups = settings.sourceGroups.filter(g => g.trim());
    if (sourceGroups.length === 0 || !settings.targetGroup.trim()) {
      addLog("error", "يرجى تحديد كروب مصدر واحد على الأقل والمجموعة المستهدفة");
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
    addedUserIdsRef.current.clear();
    successfulMembersRef.current = [];
    setSuccessfulMembers([]);
    statsRef.current = { totalAdded: 0, totalFailed: 0, totalSkipped: 0 };
    currentAccountIndexRef.current = 0;
    setCurrentBatch(0);
    setCurrentGroupIndex(0);
    loopCountRef.current = 0;
    onOperationStart();

    addLog("info", `🚀 بدء التشغيل التلقائي - ${sourceGroups.length} كروب مصدر`);

    // Join target group first
    addLog("info", "جاري انضمام الحسابات للمجموعة المستهدفة...");
    for (const account of activeAccounts) {
      if (abortRef.current) break;
      const result = await joinGroupWithAccount(account, settings.targetGroup);
      if (!result.success) {
        addLog("warning", `${account.phone} - فشل الانضمام للمستهدفة: ${result.error}`);
      }
      await sleep(2000);
    }

    if (abortRef.current) {
      setIsRunning(false);
      onOperationEnd();
      return;
    }

    // Main loop: iterate through all source groups
    // Outer loop for infinite mode
    do {
      loopCountRef.current++;
      if (loopCountRef.current > 1) {
        addLog("info", `🔄 الدورة ${loopCountRef.current} - إعادة المرور على الكروبات`);
        // Reset processed users for new loop (but keep stats)
        processedUserIdsRef.current.clear();
      }

      // Loop through each source group
      for (let groupIdx = 0; groupIdx < sourceGroups.length && !abortRef.current; groupIdx++) {
        const currentSourceGroup = sourceGroups[groupIdx];
        setCurrentGroupIndex(groupIdx);
        
        addLog("info", `📂 الكروب ${groupIdx + 1}/${sourceGroups.length}: ${currentSourceGroup}`);
        
        // Join this source group
        for (const account of activeAccounts) {
          if (abortRef.current) break;
          const result = await joinGroupWithAccount(account, currentSourceGroup);
          if (!result.success) {
            addLog("warning", `${account.phone} - فشل الانضمام: ${result.error}`);
          }
          await sleep(1500);
        }

        if (abortRef.current) break;

        let batchNumber = 0;
        let offset = 0;
        let hasMoreMembers = true;
        let accountIndex = 0;

        // Process this source group
        while (hasMoreMembers && !abortRef.current) {
          // Check pause
          while (pauseRef.current && !abortRef.current) {
            await sleep(500);
          }
          if (abortRef.current) break;

          batchNumber++;
          setCurrentBatch(batchNumber);
          addLog("info", `=== الكروب ${groupIdx + 1} - الدفعة ${batchNumber} ===`);

          // Get next available account for extraction
          const extractAccount = activeAccounts[accountIndex % activeAccounts.length];
          
          addLog("info", `جاري استخراج الأعضاء (offset: ${offset})...`);
          const extractResult = await extractMembers(extractAccount, currentSourceGroup, offset);

          if (extractResult.error) {
            addLog("error", `فشل الاستخراج: ${extractResult.error}`);
            accountIndex++;
            if (accountIndex >= activeAccounts.length * 2) {
              addLog("error", "فشل الاستخراج من جميع الحسابات - الانتقال للكروب التالي");
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
              addLog("success", `✅ اكتمل الكروب ${groupIdx + 1}!`);
              break;
            }
          }

          addLog("info", `تم استخراج ${members.length} عضو جديد`);
          onMembersExtracted(members);

          // Add members - Sequential account rotation (one account at a time)
          let batchAdded = 0;
          let batchFailed = 0;
          let batchSkipped = 0;

          for (let i = 0; i < members.length && !abortRef.current; i++) {
            // Check pause
            while (pauseRef.current && !abortRef.current) {
              await sleep(500);
            }
            if (abortRef.current) break;

            const member = members[i];
            
            // Skip if already added (prevent duplicate attempts across all accounts)
            if (addedUserIdsRef.current.has(member.oderId)) {
              addLog("info", `تخطي: ${member.username || member.oderId} - تمت إضافته مسبقاً`);
              batchSkipped++;
              continue;
            }
            
            // Skip members without username
            if (!member.username?.trim()) {
              onUpdateMemberStatus(member.id, "failed", "لا يملك username");
              batchSkipped++;
              statsRef.current.totalSkipped++;
              continue;
            }

            // Get current account (sequential - one at a time)
            let account = getNextAccount(activeAccounts);
            if (!account) {
              addLog("error", "لا يوجد حسابات متاحة للإضافة");
              break;
            }
            
            addLog("info", `إضافة: ${member.username}`, account.phone);
            const result = await addMember(member, account, currentSourceGroup);

            if (result.success) {
              onUpdateMemberStatus(member.id, "added");
              batchAdded++;
              statsRef.current.totalAdded++;
              addLog("success", `تمت إضافة: ${member.username}`, account.phone);
              
              // Rotate to next account after successful add
              rotateToNextAccount(activeAccounts);
            } else if (result.banned) {
              // Account is banned - deactivate and switch immediately
              onUpdateAccountStatus?.(account.id, "banned", "محظور");
              addLog("error", `⛔ الحساب ${account.phone} محظور - الانتقال للتالي`);
              
              // Remove from rotation by rotating
              rotateToNextAccount(activeAccounts);
              
              // Retry this member with next account
              i--;
              await sleep(2000);
            } else if (result.floodWait) {
              onUpdateMemberStatus(member.id, "failed", result.error);
              batchFailed++;
              statsRef.current.totalFailed++;
              addLog("warning", `Flood - تخطي للحساب التالي`, account.phone);
              onUpdateAccountStatus?.(account.id, "flood", `انتظار ${result.floodWait}s`);
              
              // Don't wait - just switch to next account
              rotateToNextAccount(activeAccounts);
              
              // Retry with next account
              i--;
              await sleep(1000);
            } else if (result.skip) {
              onUpdateMemberStatus(member.id, "skipped", result.error);
              batchSkipped++;
              statsRef.current.totalSkipped++;
              addLog("info", `تخطي: ${member.username} - ${result.error}`);
            } else {
              onUpdateMemberStatus(member.id, "failed", result.error);
              batchFailed++;
              statsRef.current.totalFailed++;
              addLog("error", `فشل: ${member.username} - ${result.error}`);
              
              // On general error, try next account
              rotateToNextAccount(activeAccounts);
            }

            onUpdateProgress({
              current: i + 1,
              total: members.length,
              batch: batchNumber,
              groupIndex: groupIdx,
              totalGroups: sourceGroups.length,
            });

            const delay = getRandomDelay();
            await sleep(delay * 1000);
          }

          addLog("info", `الدفعة ${batchNumber}: ${batchAdded} نجاح، ${batchFailed} فشل، ${batchSkipped} تخطي`);

          if (hasMoreMembers && !abortRef.current) {
            addLog("info", `انتظار ${settings.delayBetweenBatches} ثانية قبل الدفعة التالية...`);
            await sleep(settings.delayBetweenBatches * 1000);
          }
        }

        // Delay between groups
        if (groupIdx < sourceGroups.length - 1 && !abortRef.current) {
          addLog("info", `⏳ انتظار 60 ثانية قبل الكروب التالي...`);
          await sleep(60000);
        }
      }

      if (settings.infiniteLoop && !abortRef.current) {
        addLog("info", `♾️ الوضع اللانهائي - انتظار 5 دقائق قبل الدورة التالية...`);
        await sleep(300000); // 5 minutes between loops
      }
    } while (settings.infiniteLoop && !abortRef.current);

    // Complete
    const finalStats = statsRef.current;
    setIsRunning(false);
    setIsPaused(false);
    onOperationEnd();

    const message = `🎉 اكتملت العملية! الإجمالي: ${finalStats.totalAdded} نجاح، ${finalStats.totalFailed} فشل، ${finalStats.totalSkipped} تخطي`;
    addLog("success", message);
    
    sendNotification("🎉 اكتملت العملية!", message);
    
    onComplete({ ...finalStats, successfulMembers: successfulMembersRef.current });
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
    currentGroupIndex,
    successfulMembers,
    startAutoAdd,
    pauseAutoAdd,
    resumeAutoAdd,
    stopAutoAdd,
  };
}
