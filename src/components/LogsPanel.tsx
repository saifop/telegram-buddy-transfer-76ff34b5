import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Trash2, Download } from "lucide-react";
import type { LogEntry } from "@/pages/Index";

interface LogsPanelProps {
  logs: LogEntry[];
  onClear: () => void;
}

const typeConfig = {
  info: { color: "text-blue-500", bg: "bg-blue-500/10" },
  success: { color: "text-green-500", bg: "bg-green-500/10" },
  warning: { color: "text-yellow-500", bg: "bg-yellow-500/10" },
  error: { color: "text-red-500", bg: "bg-red-500/10" },
};

export function LogsPanel({ logs, onClear }: LogsPanelProps) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const handleExport = () => {
    const content = logs
      .map(
        (log) =>
          `[${formatTime(log.timestamp)}] [${log.type.toUpperCase()}] ${
            log.accountPhone ? `[${log.accountPhone}] ` : ""
          }${log.message}`
      )
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            السجلات ({logs.length})
          </CardTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExport}
              disabled={logs.length === 0}
              title="تصدير السجلات"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={logs.length === 0}
              title="مسح السجلات"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد سجلات</p>
              <p className="text-xs">ستظهر السجلات هنا عند بدء العمليات</p>
            </div>
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {logs.map((log) => {
                const config = typeConfig[log.type];
                return (
                  <div
                    key={log.id}
                    className={`p-2 rounded ${config.bg} flex gap-2 items-start`}
                  >
                    <span className="text-muted-foreground whitespace-nowrap" dir="ltr">
                      {formatTime(log.timestamp)}
                    </span>
                    {log.accountPhone && (
                      <span className="text-muted-foreground" dir="ltr">
                        [{log.accountPhone}]
                      </span>
                    )}
                    <span className={config.color}>{log.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
