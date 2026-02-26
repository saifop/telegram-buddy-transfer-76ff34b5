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

  // Fetch existing members from the target group
  const fetchTargetGroupMembers = async (
    account: TelegramAccount
  ): Promise<Set<string>> => {
    const combined = new Set<string>();
    let offset = 0;
    let hasMore = true;
    let safety = 0;

    addLog("info", `🔍 جاري فحص أعضاء المجموعة المستهدفة...`);

    while (hasMore && safety < 100) {
      safety++;
      try {
        const { data, error } = await supabase.functions.invoke("telegram-auth", {
          body: {
            action: "getGroupMembers",
            sessionString: account.sessionString,
            groupLink: settings.targetGroup,
            apiId: account.apiId,
            apiHash: account.apiHash,
            limit: 200,
            offset,
          },
        });

        if (error || data?.error) break;

        const batch = Array.isArray(data?.members) ? data.members : [];
        for (const m of batch) {
          const id = String(m?.id ?? "");
          if (id) combined.add(id);
          const uname = (m?.username || "").toLowerCase().trim();
          if (uname) combined.add(uname);
        }

        hasMore = Boolean(data?.hasMore) && batch.length > 0;
        offset = typeof data?.nextOffset === "number" ? data.nextOffset : offset + batch.length;
        await sleep(1200);
      } catch {
        break;
      }
    }

    addLog("info", `✅ ${combined.size} عضو موجود في المجموعة المستهدفة`);
    return combined;
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
            accessHash: m.accessHash || "",
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
  ): Promise<{ success: boolean; floodWait?: number; skip?: boolean; banned?: boolean; notAdmin?: boolean; error?: string }> => {
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
          accessHash: (member as any).accessHash || "",
          apiId: account.apiId,
          apiHash: account.apiHash,
        },
      });

      if (error) {
        // supabase.functions.invoke puts a generic message in error.message for non-2xx
        // The actual error body with Arabic text is in `data`
        const actualErrorMsg = data?.error || error.message || "";
        
        const isBanned = actualErrorMsg.toLowerCase().includes("banned") || 
                         actualErrorMsg.toLowerCase().includes("محظور") ||
                         actualErrorMsg.includes("CHAT_WRITE_FORBIDDEN") ||
                         actualErrorMsg.includes("USER_BANNED");
        
        // Check flood
        if (actualErrorMsg.includes("flood") || actualErrorMsg.includes("FLOOD") || 
            actualErrorMsg.includes("تم تجاوز الحد") || actualErrorMsg.includes("429")) {
          const waitSeconds = extractFloodWaitSeconds(actualErrorMsg);
          return { success: false, floodWait: waitSeconds, error: actualErrorMsg };
        }
        
        // Check skippable
        if (actualErrorMsg.includes("USER_PRIVACY_RESTRICTED") || actualErrorMsg.includes("خصوصية") ||
            actualErrorMsg.includes("موجود مسبقاً") || actualErrorMsg.includes("USER_ALREADY_PARTICIPANT") ||
            actualErrorMsg.includes("USER_CHANNELS_TOO_MUCH") || actualErrorMsg.includes("500 مجموعة")) {
          addedUserIdsRef.current.add(member.oderId);
          return { success: false, skip: true, error: actualErrorMsg };
        }
        
        return { success: false, error: actualErrorMsg, banned: isBanned };
      }

      if (data?.success) {
        // Check if server returned success but it was actually "already participant"
        if (data?.alreadyParticipant) {
          addedUserIdsRef.current.add(member.oderId);
          return { success: false, skip: true, error: "العضو موجود مسبقاً في المجموعة" };
        }
        
        // Trust server success - InviteToChannel completed without throwing
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

      // Check if banned (actual ban)
      if (errorMsg.toLowerCase().includes("banned") || 
          errorMsg.toLowerCase().includes("محظور") ||
          errorMsg.includes("USER_BANNED")) {
        return { success: false, banned: true, error: errorMsg };
      }

      // CHAT_WRITE_FORBIDDEN = not admin, rotate account
      if (errorMsg.includes("CHAT_WRITE_FORBIDDEN") || errorMsg.includes("ليس لديك صلاحية") || errorMsg.includes("مشرف")) {
        return { success: false, notAdmin: true, error: errorMsg };
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
        errorMsg.includes("USER_ALREADY_PARTICIPANT") ||
        errorMsg.includes("جهة اتصال متبادلة") ||
        errorMsg.includes("PEER_ID_INVALID") ||
        errorMsg.includes("ADD_NOT_CONFIRMED") ||
        errorMsg.includes("لم يتم تأكيد") ||
        errorMsg.includes("لا يمكن التعرف") ||
        errorMsg.includes("INPUT_USER_DEACTIVATED") ||
        errorMsg.includes("USER_ID_INVALID")
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

    // Main loop: iterate through all source groups
    // Outer loop for infinite mode
    do {
      loopCountRef.current++;
      if (loopCountRef.current > 1) {
        addLog("info", `🔄 الدورة ${loopCountRef.current} - إعادة المرور على الكروبات`);
        processedUserIdsRef.current.clear();
      }

      // Loop through each source group
      for (let groupIdx = 0; groupIdx < sourceGroups.length && !abortRef.current; groupIdx++) {
        const currentSourceGroup = sourceGroups[groupIdx];
        setCurrentGroupIndex(groupIdx);
        
        addLog("info", `📂 الكروب ${groupIdx + 1}/${sourceGroups.length}: ${currentSourceGroup}`);

        // === PHASE 1: Extract ALL members - one account joins and extracts ===
        addLog("info", `📥 جاري استخراج جميع الأعضاء من الكروب...`);
        let offset = 0;
        let hasMoreMembers = true;
        let extractAccountIndex = 0;
        const allGroupMembers: Member[] = [];
        const groupSeenIds = new Set<string>();
        let extractResult_lastFailed = false;

        while (hasMoreMembers && !abortRef.current) {
          const extractAccount = activeAccounts[extractAccountIndex % activeAccounts.length];
          
          // Skip join step - go straight to extraction
          
          const extractResult = await extractMembers(extractAccount, currentSourceGroup, offset);
          extractResult_lastFailed = false;

          if (extractResult.error) {
            addLog("warning", `فشل الاستخراج: ${extractResult.error}`);
            extractAccountIndex++;
            extractResult_lastFailed = true;
            if (extractAccountIndex >= activeAccounts.length) {
              addLog("error", "فشل الاستخراج من جميع الحسابات");
              break;
            }
            await sleep(5000);
            continue;
          }

          // Deduplicate within this group extraction
          for (const m of extractResult.members) {
            if (!groupSeenIds.has(m.oderId) && !addedUserIdsRef.current.has(m.oderId)) {
              groupSeenIds.add(m.oderId);
              allGroupMembers.push(m);
            }
          }

          hasMoreMembers = extractResult.hasMore;
          offset += settings.membersPerBatch;
          
          addLog("info", `تم استخراج ${allGroupMembers.length} عضو فريد حتى الآن...`);
          await sleep(2000);
        }

        if (abortRef.current) break;
        
        if (allGroupMembers.length === 0) {
          addLog("warning", `لا يوجد أعضاء جدد في الكروب ${groupIdx + 1}`);
          continue;
        }

        addLog("success", `✅ اكتمل الاستخراج: ${allGroupMembers.length} عضو فريد`);
        onMembersExtracted(allGroupMembers);

        // === PHASE 2: Add members directly (USER_ALREADY_PARTICIPANT handled per-member) ===
        const membersToAdd = allGroupMembers.filter(m => !addedUserIdsRef.current.has(m.oderId));

        let batchAdded = 0;
        let batchFailed = 0;
        let batchSkipped = 0;

        // === PHASE 3: Add remaining members ===
        addLog("info", `📤 بدء إضافة ${membersToAdd.length} عضو...`);

        for (let i = 0; i < membersToAdd.length && !abortRef.current; i++) {
          // Check pause
          while (pauseRef.current && !abortRef.current) {
            await sleep(500);
          }
          if (abortRef.current) break;

          const member = membersToAdd[i];
          
          // Skip if already added
          if (addedUserIdsRef.current.has(member.oderId)) {
            batchSkipped++;
            continue;
          }

          const memberLabel = member.username ? `@${member.username}` : (member.firstName || `ID:${member.oderId}`);

          let memberDone = false;
          let accountRetries = 0;
          const maxAccountRetries = activeAccounts.length;

          while (!memberDone && accountRetries < maxAccountRetries && !abortRef.current) {
            const account = getNextAccount(activeAccounts);
            if (!account) {
              addLog("error", "لا يوجد حسابات متاحة للإضافة");
              memberDone = true;
              onUpdateMemberStatus(member.id, "failed", "لا يوجد حسابات متاحة");
              batchFailed++;
              statsRef.current.totalFailed++;
              break;
            }
            
            addLog("info", `إضافة: ${memberLabel}`, account.phone);
            const result = await addMember(member, account, currentSourceGroup);

            if (result.success) {
              onUpdateMemberStatus(member.id, "added");
              batchAdded++;
              statsRef.current.totalAdded++;
              addLog("success", `✅ تمت إضافة: ${memberLabel}`, account.phone);
              rotateToNextAccount(activeAccounts);
              memberDone = true;
            } else if (result.skip) {
              onUpdateMemberStatus(member.id, "skipped", result.error);
              batchSkipped++;
              statsRef.current.totalSkipped++;
              addLog("info", `⏭️ تخطي: ${memberLabel} - ${result.error}`);
              memberDone = true;
            } else if (result.notAdmin) {
              onUpdateAccountStatus?.(account.id, "error", "ليس مشرفاً");
              addLog("error", `⚠️ ${account.phone} ليس مشرفاً - تجربة الحساب التالي`);
              rotateToNextAccount(activeAccounts);
              accountRetries++;
              await sleep(2000);
            } else if (result.banned) {
              onUpdateAccountStatus?.(account.id, "banned", "محظور");
              addLog("error", `⛔ ${account.phone} محظور - إعادة محاولة بالحساب التالي`);
              rotateToNextAccount(activeAccounts);
              accountRetries++;
              await sleep(2000);
            } else if (result.floodWait) {
              const waitSec = result.floodWait;
              addLog("warning", `⚠️ Flood Wait ${waitSec}s على ${account.phone} - ينتظر ثم يعيد`, account.phone);
              onUpdateAccountStatus?.(account.id, "flood", `انتظار ${waitSec}s`);
              // Wait the flood time then retry with SAME account
              await sleep(waitSec * 1000);
              onUpdateAccountStatus?.(account.id, "connected", undefined);
              addLog("info", `✅ ${account.phone} - استئناف بعد Flood Wait`);
              accountRetries++;
            } else {
              addLog("warning", `فشل: ${memberLabel} بحساب ${account.phone} - إعادة بالتالي`);
              rotateToNextAccount(activeAccounts);
              accountRetries++;
              await sleep(3000);
            }
          }

          if (!memberDone) {
            onUpdateMemberStatus(member.id, "failed", "استنفذت كل الحسابات");
            batchFailed++;
            statsRef.current.totalFailed++;
            addLog("error", `❌ فشل إضافة ${memberLabel} - استنفذت كل الحسابات`);
          }

          onUpdateProgress({
            current: i + 1,
            total: membersToAdd.length,
            batch: 1,
            groupIndex: groupIdx,
            totalGroups: sourceGroups.length,
          });

          const delay = getRandomDelay();
          await sleep(delay * 1000);
        }

        addLog("info", `الكروب ${groupIdx + 1}: ${batchAdded} نجاح، ${batchFailed} فشل، ${batchSkipped} تخطي`);

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
