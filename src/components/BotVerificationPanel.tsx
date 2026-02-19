import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Users, RefreshCw, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface VerificationSnapshot {
  timestamp: string;
  count: number;
  label: string;
}

export function BotVerificationPanel() {
  const [groupLink, setGroupLink] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [botInfo, setBotInfo] = useState<{ username: string; first_name: string } | null>(null);
  const [currentCount, setCurrentCount] = useState<number | null>(null);
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<VerificationSnapshot[]>([]);
  const [botError, setBotError] = useState<string | null>(null);
  const [isBotReady, setIsBotReady] = useState<boolean | null>(null);

  // Check bot status on load
  const checkBot = async () => {
    setIsLoading(true);
    setBotError(null);
    try {
      const { data, error } = await supabase.functions.invoke("bot-verify", {
        body: { action: "getBotInfo" },
      });
      if (error || !data?.success) {
        setBotError(data?.error || error?.message || "فشل الاتصال بالبوت");
        setIsBotReady(false);
      } else {
        setBotInfo(data.bot);
        setIsBotReady(true);
        toast.success(`البوت @${data.bot.username} جاهز ✅`);
      }
    } catch (err) {
      setBotError("خطأ في الاتصال بخادم التحقق");
      setIsBotReady(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Get current member count
  const getMemberCount = async (label?: string) => {
    if (!groupLink.trim()) {
      toast.error("أدخل رابط المجموعة أولاً");
      return;
    }
    setIsLoading(true);
    setBotError(null);
    try {
      const { data, error } = await supabase.functions.invoke("bot-verify", {
        body: { action: "getMemberCount", groupLink: groupLink.trim() },
      });

      if (error || !data?.success) {
        const errMsg = data?.error || error?.message || "خطأ غير معروف";
        setBotError(errMsg);
        if (data?.hint) {
          toast.error(errMsg, { description: data.hint });
        } else {
          toast.error(errMsg);
        }
      } else {
        setCurrentCount(data.memberCount);
        setChatTitle(data.chatTitle);

        const snap: VerificationSnapshot = {
          timestamp: new Date().toLocaleTimeString("ar-SA"),
          count: data.memberCount,
          label: label || `فحص ${snapshots.length + 1}`,
        };
        setSnapshots((prev) => [...prev, snap]);
        toast.success(`عدد الأعضاء الحالي: ${data.memberCount.toLocaleString()}`);
      }
    } catch (err) {
      setBotError("خطأ في الاتصال");
      toast.error("خطأ في الاتصال بخادم التحقق");
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate actual additions between snapshots
  const getActualAdditions = () => {
    if (snapshots.length < 2) return null;
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    return last.count - first.count;
  };

  const actualAdded = getActualAdditions();

  return (
    <Card className="border-2 border-dashed border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          تحقق البوت من الإضافة الحقيقية
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Bot Status */}
        <div className="flex items-center gap-2">
          {isBotReady === null ? (
            <Badge variant="outline" className="gap-1">
              <span className="w-2 h-2 rounded-full bg-muted-foreground" />
              البوت غير محدد
            </Badge>
          ) : isBotReady ? (
            <Badge className="gap-1 bg-primary/20 text-primary border-primary/30">
              <CheckCircle2 className="w-3 h-3" />
              @{botInfo?.username} جاهز
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="w-3 h-3" />
              البوت غير متصل
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={checkBot}
            disabled={isLoading}
            className="gap-1 text-xs"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
            فحص البوت
          </Button>
        </div>

        {/* Instructions if bot not ready */}
        {isBotReady === false && (
          <div className="p-3 rounded-lg bg-accent/50 border border-border text-xs space-y-1">
            <p className="font-medium text-foreground flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              خطوات تفعيل البوت:
            </p>
            <ol className="text-muted-foreground space-y-0.5 pr-3 list-decimal">
              <li>أضف @CO0k12bot للمجموعة المستهدفة كعضو (ليس مشرفاً)</li>
              <li>اضغط "فحص البوت" مرة أخرى</li>
            </ol>
          </div>
        )}

        {/* Group Link Input */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="w-3 h-3" />
            رابط المجموعة المستهدفة للفحص
          </Label>
          <Input
            placeholder="@groupname أو https://t.me/groupname"
            value={groupLink}
            onChange={(e) => setGroupLink(e.target.value)}
            dir="ltr"
            className="text-left text-sm"
          />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => getMemberCount("قبل الإضافة 📸")}
            disabled={isLoading || !groupLink.trim()}
            className="gap-1 text-xs"
          >
            📸 سجّل قبل الإضافة
          </Button>
          <Button
            size="sm"
            onClick={() => getMemberCount("بعد الإضافة 📊")}
            disabled={isLoading || !groupLink.trim()}
            className="gap-1 text-xs"
          >
            {isLoading ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <TrendingUp className="w-3 h-3" />
            )}
            فحص الآن
          </Button>
        </div>

        {/* Error display */}
        {botError && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            {botError}
          </div>
        )}

        {/* Current Count Display */}
        {currentCount !== null && (
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-center">
            <div className="text-2xl font-bold text-primary">{currentCount.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">
              عضو حالياً في {chatTitle || "المجموعة"}
            </div>
          </div>
        )}

        {/* Actual Additions Result */}
        {actualAdded !== null && (
          <div className={`p-3 rounded-lg border text-center ${
            actualAdded > 0
              ? "bg-primary/10 border-primary/30"
              : actualAdded < 0
              ? "bg-destructive/10 border-destructive/30"
              : "bg-muted/50 border"
          }`}>
            <div className={`text-xl font-bold ${
              actualAdded > 0 ? "text-primary" : actualAdded < 0 ? "text-destructive" : "text-muted-foreground"
            }`}>
              {actualAdded > 0 ? "+" : ""}{actualAdded.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              إضافة حقيقية مؤكدة من البوت
            </div>
          </div>
        )}

        {/* Snapshots Timeline */}
        {snapshots.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">سجل الفحوصات:</p>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {snapshots.map((snap, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs p-2 rounded bg-muted/40"
                >
                  <span className="text-muted-foreground">{snap.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{snap.timestamp}</span>
                    <span className="font-bold">{snap.count.toLocaleString()}</span>
                    {i > 0 && (
                      <span className={`font-medium ${
                        snap.count - snapshots[i-1].count > 0 ? "text-green-600" : "text-red-500"
                      }`}>
                        ({snap.count - snapshots[i-1].count > 0 ? "+" : ""}{snap.count - snapshots[i-1].count})
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {snapshots.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSnapshots([])}
                className="w-full text-xs text-muted-foreground"
              >
                مسح السجل
              </Button>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          سجّل العدد قبل الإضافة ثم بعدها لمعرفة العدد الحقيقي المُضاف
        </p>
      </CardContent>
    </Card>
  );
}
