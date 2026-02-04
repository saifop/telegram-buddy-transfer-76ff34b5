import { useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { SessionManager } from "@/components/SessionManager";
import { AccountsList } from "@/components/AccountsList";
import { OperationsPanel } from "@/components/OperationsPanel";
import { LogsPanel } from "@/components/LogsPanel";
import { ControlBar } from "@/components/ControlBar";

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
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [operationStatus, setOperationStatus] = useState<"idle" | "running" | "paused">("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });

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

  const handleLoadSessions = (files: File[]) => {
    const newAccounts: TelegramAccount[] = files.map((file, index) => ({
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
      prev.map((acc) =>
        acc.id === id ? { ...acc, isSelected: !acc.isSelected } : acc
      )
    );
  };

  const handleSelectAll = (selected: boolean) => {
    setAccounts((prev) => prev.map((acc) => ({ ...acc, isSelected: selected })));
  };

  const handleRemoveAccount = (id: string) => {
    setAccounts((prev) => prev.filter((acc) => acc.id !== id));
    addLog("info", "تم إزالة حساب");
  };

  const handleStart = () => {
    setOperationStatus("running");
    addLog("info", "بدء العملية...");
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
              <span>الحسابات المحددة: {accounts.filter(a => a.isSelected).length}</span>
              <span>الإجمالي: {accounts.length}</span>
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

          {/* Main Content */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 overflow-hidden">
            {/* Left Panel - Sessions & Accounts */}
            <div className="lg:col-span-1 flex flex-col gap-4 overflow-hidden">
              <SessionManager onLoadSessions={handleLoadSessions} />
              <AccountsList
                accounts={accounts}
                onToggleAccount={handleToggleAccount}
                onSelectAll={handleSelectAll}
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
        </main>
      </div>
    </SidebarProvider>
  );
};

export default Index;
