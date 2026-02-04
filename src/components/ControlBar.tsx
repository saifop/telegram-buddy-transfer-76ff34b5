import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, Square, AlertCircle } from "lucide-react";

interface ControlBarProps {
  status: "idle" | "running" | "paused";
  progress: { current: number; total: number };
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
}

export function ControlBar({
  status,
  progress,
  onStart,
  onPause,
  onStop,
}: ControlBarProps) {
  const progressPercent =
    progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div className="h-16 border-b bg-card/50 flex items-center gap-4 px-6">
      {/* Control Buttons */}
      <div className="flex gap-2">
        {status === "running" ? (
          <Button
            onClick={onPause}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Pause className="w-4 h-4" />
            إيقاف مؤقت
          </Button>
        ) : (
          <Button
            onClick={onStart}
            size="sm"
            className="gap-2 bg-green-600 hover:bg-green-700"
          >
            <Play className="w-4 h-4" />
            بدء
          </Button>
        )}
        <Button
          onClick={onStop}
          variant="destructive"
          size="sm"
          className="gap-2"
          disabled={status === "idle"}
        >
          <Square className="w-4 h-4" />
          إيقاف
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="flex-1 max-w-md">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>التقدم</span>
          <span>
            {progress.current} / {progress.total}
          </span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Status Indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            status === "running"
              ? "bg-green-500 animate-pulse"
              : status === "paused"
              ? "bg-yellow-500"
              : "bg-gray-400"
          }`}
        />
        <span className="text-sm text-muted-foreground">
          {status === "running"
            ? "قيد التشغيل"
            : status === "paused"
            ? "متوقف مؤقتاً"
            : "جاهز"}
        </span>
      </div>

      {/* Warning */}
      <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
        <AlertCircle className="w-4 h-4" />
        <span>للأغراض التعليمية والإدارية فقط</span>
      </div>
    </div>
  );
}
