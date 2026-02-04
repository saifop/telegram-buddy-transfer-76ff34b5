import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  UserPlus,
  Clock,
  Users,
  Shield,
  AlertTriangle,
  Settings2,
  Target,
  Play,
  Pause,
  Square,
  Zap,
  RefreshCw,
} from "lucide-react";
import { useAddMembers } from "@/hooks/useAddMembers";
import { useAutoAddMembers } from "@/hooks/useAutoAddMembers";
import type { Member } from "./MembersList";
import type { TelegramAccount, LogEntry } from "@/pages/Index";

interface AddMembersPanelProps {
  members: Member[];
  accounts: TelegramAccount[];
  isRunning: boolean;
  currentProgress: { current: number; total: number };
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
  onAddMembers?: (members: Member[]) => void;
}

export interface AddSettings {
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

export function AddMembersPanel({
  members,
  accounts,
  isRunning: externalIsRunning,
  currentProgress,
  addLog,
  onUpdateProgress,
  onUpdateMemberStatus,
  onUpdateAccountStatus,
  onOperationStart,
  onOperationEnd,
  onAddMembers,
}: AddMembersPanelProps) {
  const [settings, setSettings] = useState<AddSettings>({
    targetGroup: "",
    sourceGroup: "",
    membersPerAccount: 20,
    delayMin: 30,
    delayMax: 60,
    pauseAfterBan: true,
    skipExisting: true,
    rotateAccounts: true,
    maxRetries: 2,
    cooldownAfterFlood: 300,
  });

  const [autoMode, setAutoMode] = useState(false);
  const [autoProgress, setAutoProgress] = useState({ current: 0, total: 0, batch: 0 });
  const [autoStats, setAutoStats] = useState({ totalAdded: 0, totalFailed: 0, totalSkipped: 0 });

  const { isRunning, isPaused, startAdding, pauseAdding, resumeAdding, stopAdding } = useAddMembers({
    members,
    accounts,
    settings,
    addLog,
    onUpdateProgress,
    onUpdateMemberStatus,
    onUpdateAccountStatus,
    onOperationStart,
    onOperationEnd,
  });

  const {
    isRunning: isAutoRunning,
    isPaused: isAutoPaused,
    currentBatch,
    startAutoAdd,
    pauseAutoAdd,
    resumeAutoAdd,
    stopAutoAdd,
  } = useAutoAddMembers({
    accounts,
    settings: {
      targetGroup: settings.targetGroup,
      sourceGroup: settings.sourceGroup,
      membersPerBatch: 50,
      delayMin: settings.delayMin,
      delayMax: settings.delayMax,
      delayBetweenBatches: 30,
      cooldownAfterFlood: settings.cooldownAfterFlood,
    },
    addLog,
    onUpdateProgress: (p) => setAutoProgress(p),
    onMembersExtracted: (newMembers) => {
      onAddMembers?.(newMembers);
    },
    onUpdateMemberStatus,
    onUpdateAccountStatus,
    onOperationStart,
    onOperationEnd,
    onComplete: (stats) => {
      setAutoStats(stats);
    },
  });

  const selectedMembers = members.filter((m) => m.isSelected && m.status === "pending");
  const activeAccounts = accounts.filter((a) => a.isSelected && a.status === "connected");

  const estimatedTime = () => {
    if (selectedMembers.length === 0 || activeAccounts.length === 0) return "غير متاح";
    const avgDelay = (settings.delayMin + settings.delayMax) / 2;
    const totalSeconds = selectedMembers.length * avgDelay;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `~${hours} ساعة و ${minutes} دقيقة`;
    return `~${minutes} دقيقة`;
  };

  const progressPercent =
    currentProgress.total > 0 ? (currentProgress.current / currentProgress.total) * 100 : 0;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          إضافة الأعضاء
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto space-y-5">
        {/* Source Group */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            المجموعة المصدر (التي تم استخراج الأعضاء منها)
          </Label>
          <Input
            placeholder="https://t.me/sourcegroup أو @sourcegroup"
            value={settings.sourceGroup}
            onChange={(e) => setSettings({ ...settings, sourceGroup: e.target.value })}
            dir="ltr"
            className="text-left"
          />
          <p className="text-xs text-muted-foreground">مطلوب للعثور على الأعضاء الذين ليس لديهم username</p>
        </div>

        {/* Target Group */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Target className="w-4 h-4" />
            المجموعة المستهدفة
          </Label>
          <Input
            placeholder="https://t.me/groupname أو @groupname"
            value={settings.targetGroup}
            onChange={(e) => setSettings({ ...settings, targetGroup: e.target.value })}
            dir="ltr"
            className="text-left"
          />
        </div>

        {/* Auto Mode Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <div>
              <Label className="text-sm font-medium">التشغيل التلقائي المستمر</Label>
              <p className="text-xs text-muted-foreground">استخراج وإضافة تلقائي حتى اكتمال المجموعة</p>
            </div>
          </div>
          <Switch
            checked={autoMode}
            onCheckedChange={setAutoMode}
            disabled={isRunning || isAutoRunning}
          />
        </div>

        {/* Control Buttons */}
        <div className="flex gap-2">
          {autoMode ? (
            // Auto mode buttons
            !isAutoRunning ? (
              <Button
                onClick={startAutoAdd}
                className="flex-1 gap-2 bg-gradient-to-r from-primary to-primary/80"
                disabled={activeAccounts.length === 0 || !settings.targetGroup.trim() || !settings.sourceGroup.trim()}
              >
                <RefreshCw className="w-4 h-4" />
                بدء التشغيل التلقائي
              </Button>
            ) : (
              <>
                {isAutoPaused ? (
                  <Button onClick={resumeAutoAdd} className="flex-1 gap-2">
                    <Play className="w-4 h-4" />
                    استئناف
                  </Button>
                ) : (
                  <Button onClick={pauseAutoAdd} variant="outline" className="flex-1 gap-2">
                    <Pause className="w-4 h-4" />
                    إيقاف مؤقت
                  </Button>
                )}
                <Button onClick={stopAutoAdd} variant="destructive" className="gap-2">
                  <Square className="w-4 h-4" />
                  إيقاف
                </Button>
              </>
            )
          ) : (
            // Manual mode buttons
            !isRunning ? (
              <Button
                onClick={startAdding}
                className="flex-1 gap-2"
                disabled={selectedMembers.length === 0 || activeAccounts.length === 0 || !settings.targetGroup.trim()}
              >
                <Play className="w-4 h-4" />
                بدء الإضافة ({selectedMembers.length} عضو)
              </Button>
            ) : (
              <>
                {isPaused ? (
                  <Button onClick={resumeAdding} className="flex-1 gap-2">
                    <Play className="w-4 h-4" />
                    استئناف
                  </Button>
                ) : (
                  <Button onClick={pauseAdding} variant="outline" className="flex-1 gap-2">
                    <Pause className="w-4 h-4" />
                    إيقاف مؤقت
                  </Button>
                )}
                <Button onClick={stopAdding} variant="destructive" className="gap-2">
                  <Square className="w-4 h-4" />
                  إيقاف
                </Button>
              </>
            )
          )}
        </div>

        {/* Progress (when running - manual mode) */}
        {isRunning && !autoMode && (
          <div className="p-4 rounded-lg bg-accent/50 border space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">التقدم:</span>
              <span className="font-medium">
                {currentProgress.current} / {currentProgress.total}
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {isPaused ? "متوقف مؤقتاً" : "جاري الإضافة... يرجى الانتظار"}
            </p>
          </div>
        )}

        {/* Progress (when running - auto mode) */}
        {isAutoRunning && autoMode && (
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary animate-spin" />
                <span className="text-sm font-medium">التشغيل التلقائي</span>
              </div>
              <Badge variant="outline" className="bg-primary/10">
                الدفعة {currentBatch}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">التقدم في الدفعة:</span>
              <span className="font-medium">
                {autoProgress.current} / {autoProgress.total}
              </span>
            </div>
            <Progress 
              value={autoProgress.total > 0 ? (autoProgress.current / autoProgress.total) * 100 : 0} 
              className="h-2" 
            />
            
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="text-center p-2 rounded bg-green-500/10">
                <div className="font-bold text-green-600">{autoStats.totalAdded}</div>
                <div className="text-muted-foreground">نجاح</div>
              </div>
              <div className="text-center p-2 rounded bg-red-500/10">
                <div className="font-bold text-red-600">{autoStats.totalFailed}</div>
                <div className="text-muted-foreground">فشل</div>
              </div>
              <div className="text-center p-2 rounded bg-yellow-500/10">
                <div className="font-bold text-yellow-600">{autoStats.totalSkipped}</div>
                <div className="text-muted-foreground">تخطي</div>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground text-center">
              {isAutoPaused ? "متوقف مؤقتاً" : "يستخرج ويضيف تلقائياً... سيتم إشعارك عند الاكتمال"}
            </p>
          </div>
        )}

        {/* Stats Card */}
        <div className="p-4 rounded-lg bg-muted/50 border space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              الأعضاء المحددون:
            </span>
            <span className="font-medium">{selectedMembers.length}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Shield className="w-4 h-4" />
              الحسابات النشطة:
            </span>
            <span className="font-medium">{activeAccounts.length}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              الوقت التقريبي:
            </span>
            <span className="font-medium">{estimatedTime()}</span>
          </div>
        </div>

        {/* Limits Settings */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            حدود الاستخدام
          </h4>

          {/* Members per account */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">أعضاء لكل حساب</Label>
              <span className="text-sm font-medium">{settings.membersPerAccount}</span>
            </div>
            <Slider
              value={[settings.membersPerAccount]}
              onValueChange={(v) => setSettings({ ...settings, membersPerAccount: v[0] })}
              min={5}
              max={50}
              step={5}
            />
          </div>

          {/* Delay Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">التأخير (أدنى)</Label>
              <Input
                type="number"
                value={settings.delayMin}
                onChange={(e) => setSettings({ ...settings, delayMin: Number(e.target.value) })}
                min={5}
                max={300}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">التأخير (أقصى)</Label>
              <Input
                type="number"
                value={settings.delayMax}
                onChange={(e) => setSettings({ ...settings, delayMax: Number(e.target.value) })}
                min={5}
                max={300}
              />
            </div>
          </div>

          {/* Cooldown after flood */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              فترة الانتظار بعد تحذير Flood (ثانية)
            </Label>
            <Input
              type="number"
              value={settings.cooldownAfterFlood}
              onChange={(e) =>
                setSettings({ ...settings, cooldownAfterFlood: Number(e.target.value) })
              }
              min={60}
              max={3600}
            />
          </div>

          {/* Max Retries */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">عدد المحاولات</Label>
              <span className="text-sm font-medium">{settings.maxRetries}</span>
            </div>
            <Slider
              value={[settings.maxRetries]}
              onValueChange={(v) => setSettings({ ...settings, maxRetries: v[0] })}
              min={0}
              max={5}
              step={1}
            />
          </div>
        </div>

        {/* Protection Settings */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4" />
            إعدادات الحماية
          </h4>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">إيقاف عند الحظر</Label>
              <Switch
                checked={settings.pauseAfterBan}
                onCheckedChange={(v) => setSettings({ ...settings, pauseAfterBan: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-sm">تخطي المضافين مسبقاً</Label>
              <Switch
                checked={settings.skipExisting}
                onCheckedChange={(v) => setSettings({ ...settings, skipExisting: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-sm">تبديل الحسابات تلقائياً</Label>
              <Switch
                checked={settings.rotateAccounts}
                onCheckedChange={(v) => setSettings({ ...settings, rotateAccounts: v })}
              />
            </div>
          </div>
        </div>

        {/* Warning */}
        <div className="p-3 rounded-lg bg-accent/40 border flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-foreground/70 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-foreground/80">
            <p className="font-medium">تنبيه هام:</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>• الإضافة المفرطة قد تؤدي لحظر الحسابات</li>
              <li>• استخدم تأخيراً مناسباً بين كل عملية</li>
              <li>• لا تتجاوز الحدود اليومية المسموحة</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
