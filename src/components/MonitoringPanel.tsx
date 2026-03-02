import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import type { TelegramAccount } from "@/pages/Index";
import {
  Radio,
  Square,
  Plus,
  Trash2,
  Download,
  Eye,
  Users,
  Clock,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface MonitoringPanelProps {
  accounts: TelegramAccount[];
}

interface MonitoredMember {
  id: string;
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  access_hash: string | null;
  source_group: string | null;
  message_text: string | null;
  discovered_at: string;
}

interface MonitoringSession {
  id: string;
  status: string;
  groups: string[];
  accounts: Array<{ phone: string }>;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  total_members_found: number;
}

export function MonitoringPanel({ accounts }: MonitoringPanelProps) {
  const [groups, setGroups] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("monitor_groups");
      return saved ? JSON.parse(saved) : [""];
    } catch { return [""]; }
  });
  const [activeSession, setActiveSession] = useState<MonitoringSession | null>(null);
  const [members, setMembers] = useState<MonitoredMember[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [liveStatus, setLiveStatus] = useState<{
    active: boolean;
    membersFound?: number;
    uptime?: number;
    connectedAccounts?: number;
  } | null>(null);

  const connectedAccounts = accounts.filter(
    (a) => a.status === "connected" && a.sessionString
  );

  // Persist groups to localStorage
  useEffect(() => {
    try { localStorage.setItem("monitor_groups", JSON.stringify(groups)); } catch {}
  }, [groups]);

  // Load active session on mount
  useEffect(() => {
    loadActiveSession();
  }, []);

  // Poll for members and status when monitoring is active
  useEffect(() => {
    if (!activeSession || activeSession.status !== "running") return;

    // Initial load
    loadMembers(activeSession.id);
    checkLiveStatus(activeSession.id);

    const interval = setInterval(() => {
      loadMembers(activeSession.id);
      checkLiveStatus(activeSession.id);
    }, 8000);

    return () => clearInterval(interval);
  }, [activeSession]);

  const loadActiveSession = async () => {
    const { data } = await supabase
      .from("monitoring_sessions")
      .select("*")
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const session = data[0] as unknown as MonitoringSession;
      session.groups = (session.groups as unknown as string[]) || [];
      session.accounts = (session.accounts as unknown as Array<{ phone: string }>) || [];
      setActiveSession(session);
      loadMembers(session.id);
      checkLiveStatus(session.id);
    } else {
      const { data: stopped } = await supabase
        .from("monitoring_sessions")
        .select("*")
        .eq("status", "stopped")
        .order("stopped_at", { ascending: false })
        .limit(1);

      if (stopped && stopped.length > 0) {
        const session = stopped[0] as unknown as MonitoringSession;
        session.groups = (session.groups as unknown as string[]) || [];
        session.accounts = (session.accounts as unknown as Array<{ phone: string }>) || [];
        setActiveSession(session);
        loadMembers(session.id);
      }
    }
  };

  const loadMembers = async (sessionId: string) => {
    const { data } = await supabase
      .from("monitored_members")
      .select("*")
      .eq("session_id", sessionId)
      .order("discovered_at", { ascending: false });

    if (data) {
      setMembers(data as unknown as MonitoredMember[]);
    }
  };

  const checkLiveStatus = async (sessionId: string) => {
    try {
      const { data } = await supabase.functions.invoke("telegram-auth", {
        body: { action: "getMonitoringStatus", sessionId },
      });
      if (data) {
        setLiveStatus(data);
      }
    } catch {
      // ignore
    }
  };

  const handleAddGroup = () => setGroups((prev) => [...prev, ""]);

  const handleRemoveGroup = (index: number) => {
    setGroups((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGroupChange = (index: number, value: string) => {
    setGroups((prev) => prev.map((g, i) => (i === index ? value : g)));
  };

  const handleStart = async () => {
    const validGroups = groups.filter((g) => g.trim());
    if (validGroups.length === 0) {
      toast.error("أدخل رابط مجموعة واحد على الأقل");
      return;
    }
    if (connectedAccounts.length === 0) {
      toast.error("لا توجد حسابات متصلة - أضف حساب أولاً من تبويب الحسابات");
      return;
    }

    setIsStarting(true);
    try {
      const { data: session, error: sessionErr } = await supabase
        .from("monitoring_sessions")
        .insert({
          status: "idle",
          groups: validGroups as unknown as any,
          accounts: connectedAccounts.map((a) => ({ phone: a.phone })) as unknown as any,
        })
        .select()
        .single();

      if (sessionErr || !session) {
        toast.error("فشل إنشاء جلسة المراقبة");
        setIsStarting(false);
        return;
      }

      const accountsData = connectedAccounts.map((a) => ({
        phone: a.phone,
        sessionString: a.sessionString,
        apiId: a.apiId,
        apiHash: a.apiHash,
      }));

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "startMonitoring",
          accounts: accountsData,
          groups: validGroups,
          sessionId: session.id,
          supabaseUrl,
          supabaseKey,
        },
      });

      if (error || data?.error) {
        toast.error(data?.error || "فشل بدء المراقبة");
        await supabase.from("monitoring_sessions").delete().eq("id", session.id);
      } else {
        const updated = {
          ...session,
          status: "running",
          groups: validGroups,
          accounts: accountsData.map((a) => ({ phone: a.phone })),
        } as unknown as MonitoringSession;
        setActiveSession(updated);
        toast.success(`بدأ الاستخراج والمراقبة - ${data?.membersExtracted || 0} عضو موجود`);
      }
    } catch (err: any) {
      toast.error("خطأ: " + (err.message || "فشل بدء المراقبة"));
    }
    setIsStarting(false);
  };

  const handleStop = async () => {
    if (!activeSession) return;
    setIsStopping(true);
    try {
      await supabase.functions.invoke("telegram-auth", {
        body: { action: "stopMonitoring", sessionId: activeSession.id },
      });
      setActiveSession((prev) => (prev ? { ...prev, status: "stopped" } : null));
      setLiveStatus(null);
      toast.success("تم إيقاف المراقبة");
    } catch {
      toast.error("فشل إيقاف المراقبة");
    }
    setIsStopping(false);
  };

  const handleDownload = () => {
    if (members.length === 0) return;
    const data = members.map((m) => ({
      id: m.telegram_user_id,
      username: m.username,
      firstName: m.first_name,
      lastName: m.last_name,
      accessHash: m.access_hash,
      sourceGroup: m.source_group,
      discoveredAt: m.discovered_at,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monitored-members-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`تم تحميل ${members.length} عضو`);
  };

  const handleRefresh = () => {
    if (activeSession) {
      loadMembers(activeSession.id);
      checkLiveStatus(activeSession.id);
    }
  };

  const handleNewSession = () => {
    setActiveSession(null);
    setMembers([]);
    setLiveStatus(null);
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}س ${m}د ${s}ث`;
  };

  const filteredMembers = members.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.username?.toLowerCase().includes(q) ||
      m.first_name?.toLowerCase().includes(q) ||
      m.last_name?.toLowerCase().includes(q) ||
      m.telegram_user_id.includes(q) ||
      m.source_group?.toLowerCase().includes(q)
    );
  });

  const isRunning = activeSession?.status === "running";

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Config + Status Panel */}
      <div className="lg:col-span-1 flex flex-col gap-4 overflow-hidden">
        {/* Active session status */}
        {activeSession && isRunning && (
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Radio className="w-4 h-4 text-green-500 animate-pulse" />
                المراقبة نشطة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge>نشطة</Badge>
                {liveStatus?.uptime != null && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatUptime(liveStatus.uptime)}
                  </span>
                )}
              </div>
              <div className="text-sm space-y-1">
                <p>المجموعات: {activeSession.groups?.length || 0}</p>
                <p>الحسابات: {liveStatus?.connectedAccounts || activeSession.accounts?.length || 0}</p>
                <p className="font-semibold text-primary">
                  الأعضاء: {liveStatus?.membersFound ?? members.length}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStop}
                  disabled={isStopping}
                  className="flex-1"
                >
                  <Square className="w-3 h-3 ml-1" />
                  {isStopping ? "جاري الإيقاف..." : "إيقاف"}
                </Button>
                <Button variant="ghost" size="icon" onClick={handleRefresh} className="h-8 w-8">
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Setup - show when no running session */}
        {(!activeSession || activeSession.status !== "running") && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">حط الروابط وابدأ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {groups.map((g, i) => (
                  <div key={i} className="flex gap-1">
                    <Input
                      placeholder="رابط المجموعة..."
                      value={g}
                      onChange={(e) => handleGroupChange(i, e.target.value)}
                      className="text-xs h-8"
                      dir="ltr"
                    />
                    {groups.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveGroup(i)}
                        className="h-8 w-8 shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={handleAddGroup} className="w-full h-7 text-xs">
                  <Plus className="w-3 h-3 ml-1" />
                  إضافة مجموعة
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">
                سيتم استخدام جميع الحسابات المتصلة ({connectedAccounts.length}) تلقائياً
              </div>

              <Button
                onClick={handleStart}
                disabled={isStarting || connectedAccounts.length === 0}
                className="w-full"
                size="sm"
              >
                {isStarting ? (
                  <>
                    <Loader2 className="w-3 h-3 ml-1 animate-spin" />
                    جاري البدء...
                  </>
                ) : (
                  <>
                    <Radio className="w-3 h-3 ml-1" />
                    ابدأ الاستخراج والمراقبة
                  </>
                )}
              </Button>

              {activeSession?.status === "stopped" && (
                <Button variant="outline" size="sm" onClick={handleNewSession} className="w-full text-xs">
                  جلسة جديدة
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Members List */}
      <div className="lg:col-span-2 overflow-hidden">
        <Card className="h-full flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4" />
                الأعضاء المكتشفين ({members.length})
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  disabled={members.length === 0}
                  className="h-7 text-xs"
                >
                  <Download className="w-3 h-3 ml-1" />
                  تحميل
                </Button>
                <Button variant="ghost" size="icon" onClick={handleRefresh} className="h-7 w-7">
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <Input
              placeholder="بحث بالاسم أو اليوزر..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs h-7 mt-2"
            />
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0 px-4 pb-4">
            <ScrollArea className="h-full">
              {filteredMembers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Eye className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">
                    {members.length === 0
                      ? isRunning
                        ? "جاري الاستخراج... سيظهر الأعضاء تلقائياً"
                        : "لم يتم اكتشاف أعضاء بعد"
                      : "لا توجد نتائج مطابقة"}
                  </p>
                  {isRunning && members.length === 0 && (
                    <Loader2 className="w-5 h-5 mt-2 animate-spin text-primary" />
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredMembers.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-2 rounded border border-border/50 hover:bg-muted/30 text-xs"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          {m.username && (
                            <span className="font-medium text-primary" dir="ltr">
                              @{m.username}
                            </span>
                          )}
                          <span className="truncate">
                            {m.first_name} {m.last_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span dir="ltr">{m.telegram_user_id}</span>
                          {m.source_group && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {m.source_group}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(m.discovered_at).toLocaleTimeString("ar")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
