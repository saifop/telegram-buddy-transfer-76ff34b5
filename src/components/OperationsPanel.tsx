import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, UserPlus, LogIn, LogOut, Clock, Users } from "lucide-react";
import type { LogEntry } from "@/pages/Index";

interface OperationsPanelProps {
  selectedAccounts: number;
  isRunning: boolean;
  addLog: (type: LogEntry["type"], message: string, accountPhone?: string) => void;
}

export function OperationsPanel({
  selectedAccounts,
  isRunning,
  addLog,
}: OperationsPanelProps) {
  const [operationType, setOperationType] = useState("join-public");
  const [groupLink, setGroupLink] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);
  const [accountsPerBatch, setAccountsPerBatch] = useState(5);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="w-4 h-4" />
          العمليات
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <Tabs defaultValue="groups" className="h-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="groups">المجموعات</TabsTrigger>
            <TabsTrigger value="settings">الإعدادات</TabsTrigger>
          </TabsList>

          <TabsContent value="groups" className="space-y-4 mt-0">
            {/* Operation Type */}
            <div className="space-y-2">
              <Label>نوع العملية</Label>
              <Select value={operationType} onValueChange={setOperationType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="join-public">
                    <span className="flex items-center gap-2">
                      <LogIn className="w-4 h-4" />
                      الانضمام لمجموعة عامة
                    </span>
                  </SelectItem>
                  <SelectItem value="join-private">
                    <span className="flex items-center gap-2">
                      <LogIn className="w-4 h-4" />
                      الانضمام لمجموعة خاصة
                    </span>
                  </SelectItem>
                  <SelectItem value="leave-public">
                    <span className="flex items-center gap-2">
                      <LogOut className="w-4 h-4" />
                      مغادرة مجموعة عامة
                    </span>
                  </SelectItem>
                  <SelectItem value="leave-private">
                    <span className="flex items-center gap-2">
                      <LogOut className="w-4 h-4" />
                      مغادرة مجموعة خاصة
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Group Link */}
            <div className="space-y-2">
              <Label htmlFor="groupLink">رابط المجموعة</Label>
              <Input
                id="groupLink"
                placeholder="https://t.me/groupname أو @groupname"
                value={groupLink}
                onChange={(e) => setGroupLink(e.target.value)}
                dir="ltr"
                className="text-left"
              />
            </div>

            {/* Target Group (for transfer operations) */}
            <div className="space-y-2">
              <Label htmlFor="targetGroup">المجموعة المستهدفة (اختياري)</Label>
              <Input
                id="targetGroup"
                placeholder="للنقل بين المجموعات"
                value={targetGroup}
                onChange={(e) => setTargetGroup(e.target.value)}
                dir="ltr"
                className="text-left"
              />
            </div>

            {/* Status */}
            <div className="p-4 rounded-lg bg-accent/50 border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">الحسابات المحددة:</span>
                <span className="font-medium">{selectedAccounts}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">الحالة:</span>
                <span
                  className={`font-medium ${
                    isRunning ? "text-green-500" : "text-muted-foreground"
                  }`}
                >
                  {isRunning ? "قيد التشغيل" : "متوقف"}
                </span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6 mt-0">
            {/* Delay Settings */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <Label>التأخير بين العمليات (ثانية)</Label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">الحد الأدنى</Label>
                  <Input
                    type="number"
                    value={delayMin}
                    onChange={(e) => setDelayMin(Number(e.target.value))}
                    min={5}
                    max={300}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">الحد الأقصى</Label>
                  <Input
                    type="number"
                    value={delayMax}
                    onChange={(e) => setDelayMax(Number(e.target.value))}
                    min={5}
                    max={300}
                  />
                </div>
              </div>
            </div>

            {/* Accounts Per Batch */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <Label>الحسابات لكل دفعة</Label>
                </div>
                <span className="text-sm font-medium">{accountsPerBatch}</span>
              </div>
              <Slider
                value={[accountsPerBatch]}
                onValueChange={(v) => setAccountsPerBatch(v[0])}
                min={1}
                max={20}
                step={1}
              />
            </div>

            {/* Protection Settings */}
            <div className="p-4 rounded-lg bg-accent/30 border space-y-3">
              <h4 className="text-sm font-medium">إعدادات الحماية</h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• إيقاف تلقائي عند الحظر</li>
                <li>• تجاهل الحسابات المقيدة</li>
                <li>• توزيع الحمل على الحسابات</li>
                <li>• تأخير عشوائي بين العمليات</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
