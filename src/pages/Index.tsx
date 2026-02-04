import { useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppSidebar } from "@/components/AppSidebar";
import { SessionManager } from "@/components/SessionManager";
import { AccountsList } from "@/components/AccountsList";
import { OperationsPanel } from "@/components/OperationsPanel";
import { LogsPanel } from "@/components/LogsPanel";
import { ControlBar } from "@/components/ControlBar";
import { MembersList, type Member } from "@/components/MembersList";
import { AddMembersPanel } from "@/components/AddMembersPanel";

export interface TelegramAccount {
  id: string;
  phone: string;
  sessionFile: string;
  status: "connected" | "disconnected" | "loading" | "error" | "banned";
  isSelected: boolean;
  lastActivity?: string;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: "info" | "success" | "warning" | "error";
  message: string;
  accountPhone?: string;
}

const Index = () => {
  const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [operationStatus, setOperationStatus] = useState<"idle" | "running" | "paused">("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [activeTab, setActiveTab] = useState("accounts");

  const addLog = (type: LogEntry["type"], message: string, accountPhone?: string) => {
    const newLog: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type,
      message,
      accountPhone,
    };
    setLogs((prev) => [newLog, ...prev].slice(0, 500));
  };

  // Account handlers
  const handleLoadSessions = (files: File[]) => {
    const newAccounts: TelegramAccount[] = files.map((file) => ({
      id: crypto.randomUUID(),
      phone: `+964${Math.floor(Math.random() * 1000000000).toString().padStart(9, "0")}`,
      sessionFile: file.name,
      status: "disconnected",
      isSelected: false,
    }));
    setAccounts((prev) => [...prev, ...newAccounts]);
    addLog("success", `تم تحميل ${files.length} ملف جلسة`);
  };

  const handleToggleAccount = (id: string) => {
    setAccounts((prev) =>
      prev.map((acc) => (acc.id === id ? { ...acc, isSelected: !acc.isSelected } : acc))
    );
  };

  const handleSelectAllAccounts = (selected: boolean) => {
    setAccounts((prev) => prev.map((acc) => ({ ...acc, isSelected: selected })));
  };

  const handleRemoveAccount = (id: string) => {
    setAccounts((prev) => prev.filter((acc) => acc.id !== id));
    addLog("info", "تم إزالة حساب");
  };

  // Member handlers
  const handleToggleMember = (id: string) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isSelected: !m.isSelected } : m))
    );
  };

  const handleSelectAllMembers = (selected: boolean) => {
    setMembers((prev) => prev.map((m) => ({ ...m, isSelected: selected })));
  };

  const handleRemoveMember = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const handleClearAllMembers = () => {
    setMembers([]);
    addLog("info", "تم مسح قائمة الأعضاء");
  };

  const handleImportMembers = (newMembers: Member[]) => {
    setMembers((prev) => [...prev, ...newMembers]);
    addLog("success", `تم استيراد ${newMembers.length} عضو`);
  };

  const handleExportMembers = () => {
    const data = members.map((m) => ({
      id: m.oderId,
      username: m.username,
      first_name: m.firstName,
      last_name: m.lastName,
      status: m.status,
      error: m.errorMessage,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("success", "تم تصدير قائمة الأعضاء");
  };

  const handleUpdateMemberStatus = (
    memberId: string,
    status: Member["status"],
    errorMessage?: string
  ) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? { ...m, status, errorMessage, addedAt: status === "added" ? new Date() : undefined }
          : m
      )
    );
  };

  // Control handlers
  const handleStart = () => {
    const selectedMembers = members.filter((m) => m.isSelected && m.status === "pending");
    if (selectedMembers.length === 0) {
      addLog("warning", "لا يوجد أعضاء محددون للإضافة");
      return;
    }
    setOperationStatus("running");
    setProgress({ current: 0, total: selectedMembers.length });
    addLog("info", `بدء إضافة ${selectedMembers.length} عضو...`);
  };

  const handlePause = () => {
    setOperationStatus("paused");
    addLog("warning", "تم إيقاف العملية مؤقتاً");
  };

  const handleStop = () => {
    setOperationStatus("idle");
    setProgress({ current: 0, total: 0 });
    addLog("info", "تم إيقاف العملية");
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background" dir="rtl">
        <AppSidebar />

        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="h-14 border-b bg-card flex items-center justify-between px-6">
            <h1 className="text-xl font-bold text-foreground">مدير حسابات تيليجرام</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>الحسابات: {accounts.filter((a) => a.isSelected).length}/{accounts.length}</span>
              <span>الأعضاء: {members.filter((m) => m.isSelected).length}/{members.length}</span>
            </div>
          </header>

          {/* Control Bar */}
          <ControlBar
            status={operationStatus}
            progress={progress}
            onStart={handleStart}
            onPause={handlePause}
            onStop={handleStop}
          />

          {/* Main Content with Tabs */}
          <div className="flex-1 p-4 overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="grid w-full max-w-md grid-cols-2 mb-4">
                <TabsTrigger value="accounts">الحسابات والمجموعات</TabsTrigger>
                <TabsTrigger value="members">إدارة الأعضاء</TabsTrigger>
              </TabsList>

              {/* Accounts Tab */}
              <TabsContent value="accounts" className="flex-1 mt-0 overflow-hidden">
                <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Left Panel - Sessions & Accounts */}
                  <div className="lg:col-span-1 flex flex-col gap-4 overflow-hidden">
                    <SessionManager onLoadSessions={handleLoadSessions} />
                    <AccountsList
                      accounts={accounts}
                      onToggleAccount={handleToggleAccount}
                      onSelectAll={handleSelectAllAccounts}
                      onRemoveAccount={handleRemoveAccount}
                    />
                  </div>

                  {/* Center Panel - Operations */}
                  <div className="lg:col-span-1 overflow-hidden">
                    <OperationsPanel
                      selectedAccounts={accounts.filter((a) => a.isSelected).length}
                      isRunning={operationStatus === "running"}
                      addLog={addLog}
                    />
                  </div>

                  {/* Right Panel - Logs */}
                  <div className="lg:col-span-1 overflow-hidden">
                    <LogsPanel logs={logs} onClear={() => setLogs([])} />
                  </div>
                </div>
              </TabsContent>

              {/* Members Tab */}
              <TabsContent value="members" className="flex-1 mt-0 overflow-hidden">
                <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Left Panel - Members List */}
                  <div className="lg:col-span-1 overflow-hidden">
                    <MembersList
                      members={members}
                      onToggleMember={handleToggleMember}
                      onSelectAll={handleSelectAllMembers}
                      onRemoveMember={handleRemoveMember}
                      onClearAll={handleClearAllMembers}
                      onImportMembers={handleImportMembers}
                      onExportMembers={handleExportMembers}
                    />
                  </div>

                  {/* Center Panel - Add Members Settings */}
                  <div className="lg:col-span-1 overflow-hidden">
                    <AddMembersPanel
                      members={members}
                      accounts={accounts}
                      isRunning={operationStatus === "running"}
                      currentProgress={progress}
                      addLog={addLog}
                      onUpdateProgress={setProgress}
                      onUpdateMemberStatus={handleUpdateMemberStatus}
                    />
                  </div>

                  {/* Right Panel - Logs */}
                  <div className="lg:col-span-1 overflow-hidden">
                    <LogsPanel logs={logs} onClear={() => setLogs([])} />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
};

export default Index;
