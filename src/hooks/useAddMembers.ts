import { useState, useCallback, useRef, useEffect } from "react";
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
  retryCycles: number;
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
  onUpdateAccountStatus?: (
    accountId: string,
    status: TelegramAccount["status"],
    statusMessage?: string
  ) => void;
  onOperationStart: () => void;
  onOperationEnd: () => void;
}

const BATCH_JOB_KEY = "tg_batch_job_id";

export function useAddMembers({
  members,
  accounts,
  settings,
  addLog,
  onUpdateProgress,
  onUpdateMemberStatus,
  onUpdateAccountStatus,
  onOperationStart,
  onOperationEnd,
}: UseAddMembersProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [jobId, setJobId] = useState<string | null>(() => {
    return localStorage.getItem(BATCH_JOB_KEY);
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLogTimeRef = useRef(0);

  // Poll for job status
  const pollStatus = useCallback(async (jid: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: { action: "getBatchAddStatus", jobId: jid },
      });
      if (error || !data) return;

      if (!data.active && data.status !== 'paused') {
        // Job finished
        setIsRunning(false);
        setIsPaused(false);
        localStorage.removeItem(BATCH_JOB_KEY);
        setJobId(null);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        onOperationEnd();

        // Sync member statuses - match by oderId (userId from backend)
        if (data.members) {
          for (const m of data.members) {
            if (m.status === 'added' || m.status === 'skipped' || m.status === 'failed') {
              // Find the frontend member by oderId
              const frontendMember = members.find(fm => fm.oderId === m.userId);
              if (frontendMember) {
                onUpdateMemberStatus(frontendMember.id, m.status as Member["status"], m.error || undefined);
              }
            }
          }
        }

        // Show new logs
        if (data.logs) {
          const newLogs = data.logs.filter((log: any) => log.time > lastLogTimeRef.current);
          for (const log of newLogs) {
            addLog(log.type as LogEntry["type"], log.msg, log.phone);
          }
          if (data.logs.length > 0) {
            lastLogTimeRef.current = Math.max(...data.logs.map((l: any) => l.time || 0));
          }
        }

        if (data.status === 'completed') {
          addLog("success", `✅ اكتملت العملية في الخلفية: ${data.successCount} نجاح، ${data.failedCount} فشل، ${data.skippedCount} تخطي`);
        } else if (data.status === 'stopped') {
          addLog("warning", "تم إيقاف العملية");
        }
        return;
      }

      // Job still running
      setIsRunning(true);
      setIsPaused(data.status === 'paused');
      onUpdateProgress({ current: data.processed, total: data.total });

      // Sync member statuses
      if (data.members) {
        for (const m of data.members) {
          if (m.status === 'added' || m.status === 'skipped' || m.status === 'failed') {
            const frontendMember = members.find(fm => fm.oderId === m.userId);
            if (frontendMember) {
              onUpdateMemberStatus(frontendMember.id, m.status as Member["status"], m.error || undefined);
            }
          }
        }
      }

      // Show new logs
      if (data.logs) {
        const newLogs = data.logs.filter((log: any) => log.time > lastLogTimeRef.current);
        for (const log of newLogs) {
          addLog(log.type as LogEntry["type"], log.msg, log.phone);
        }
        if (data.logs.length > 0) {
          lastLogTimeRef.current = Math.max(...data.logs.map((l: any) => l.time || 0));
        }
      }
    } catch (err) {
      // Network error, keep polling
    }
  }, [members, addLog, onUpdateProgress, onUpdateMemberStatus, onOperationEnd]);

  // Resume polling on mount if there's an active job
  useEffect(() => {
    if (jobId && !pollRef.current) {
      setIsRunning(true);
      onOperationStart();
      lastLogIdxRef.current = 0;
      pollRef.current = setInterval(() => pollStatus(jobId), 2000);
      // Immediate first poll
      pollStatus(jobId);
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const startAdding = useCallback(async () => {
    const selectedMembers = members.filter((m) => m.isSelected && m.status === "pending");
    const activeAccounts = accounts.filter((a) => a.isSelected && a.status === "connected" && a.sessionString);

    if (selectedMembers.length === 0) { addLog("warning", "لا يوجد أعضاء محددون للإضافة"); return; }
    if (activeAccounts.length === 0) { addLog("error", "لا يوجد حسابات متصلة"); return; }
    if (!settings.targetGroup.trim()) { addLog("error", "يرجى تحديد المجموعة المستهدفة"); return; }

    setIsRunning(true);
    onOperationStart();
    lastLogIdxRef.current = 0;
    addLog("info", `🚀 بدء عملية إضافة ${selectedMembers.length} عضو في الخلفية...`);

    // Prepare data for backend
    const membersData = selectedMembers.map(m => ({
      userId: m.oderId,
      username: m.username || "",
      firstName: m.firstName || "",
      lastName: m.lastName || "",
      accessHash: (m as any).accessHash || "",
    }));

    const accountsData = activeAccounts.map(a => ({
      sessionString: a.sessionString,
      apiId: a.apiId,
      apiHash: a.apiHash,
      phone: a.phone,
    }));

    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "startBatchAdd",
          accounts: accountsData,
          members: membersData,
          targetGroup: settings.targetGroup,
          sourceGroup: settings.sourceGroup?.trim() || "",
          settings: {
            delayMin: settings.delayMin,
            delayMax: settings.delayMax,
            maxRetries: settings.maxRetries,
            cooldownAfterFlood: settings.cooldownAfterFlood,
            retryCycles: settings.retryCycles || 0,
          },
        },
      });

      if (error || !data?.success) {
        addLog("error", `فشل بدء العملية: ${error?.message || data?.error || "خطأ"}`);
        setIsRunning(false);
        onOperationEnd();
        return;
      }

      const newJobId = data.jobId;
      setJobId(newJobId);
      localStorage.setItem(BATCH_JOB_KEY, newJobId);
      addLog("success", `✅ بدأت العملية في الخلفية - يمكنك إغلاق الصفحة والعودة لاحقاً`);

      // Start polling
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => pollStatus(newJobId), 2000);
    } catch (err) {
      addLog("error", `خطأ: ${err instanceof Error ? err.message : "خطأ"}`);
      setIsRunning(false);
      onOperationEnd();
    }
  }, [members, accounts, settings, addLog, onOperationStart, onOperationEnd, pollStatus]);

  const pauseAdding = useCallback(async () => {
    if (!jobId) return;
    setIsPaused(true);
    addLog("warning", "إيقاف مؤقت...");
    await supabase.functions.invoke("telegram-auth", {
      body: { action: "pauseBatchAdd", jobId, pause: true },
    });
  }, [jobId, addLog]);

  const resumeAdding = useCallback(async () => {
    if (!jobId) return;
    setIsPaused(false);
    addLog("info", "استئناف العملية...");
    await supabase.functions.invoke("telegram-auth", {
      body: { action: "pauseBatchAdd", jobId, pause: false },
    });
  }, [jobId, addLog]);

  const stopAdding = useCallback(async () => {
    if (!jobId) return;
    addLog("warning", "إيقاف العملية...");
    await supabase.functions.invoke("telegram-auth", {
      body: { action: "stopBatchAdd", jobId },
    });
    setIsRunning(false);
    setIsPaused(false);
    localStorage.removeItem(BATCH_JOB_KEY);
    setJobId(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    onOperationEnd();
  }, [jobId, addLog, onOperationEnd]);

  return {
    isRunning,
    isPaused,
    startAdding,
    pauseAdding,
    resumeAdding,
    stopAdding,
  };
}
