import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { ShoppingCart, Loader2, Wallet, Phone, Download, RefreshCw, Key } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface OrderInfo {
  id: number;
  phone: string;
  status: "buying" | "waiting_sms" | "registering" | "got_session" | "failed" | "timeout";
  smsCode?: string;
  sessionString?: string;
  price: number;
  errorMessage?: string;
}

const POPULAR_COUNTRIES = [
  { value: "russia", label: "🇷🇺 روسيا" },
  { value: "ukraine", label: "🇺🇦 أوكرانيا" },
  { value: "kazakhstan", label: "🇰🇿 كازاخستان" },
  { value: "indonesia", label: "🇮🇩 إندونيسيا" },
  { value: "india", label: "🇮🇳 الهند" },
  { value: "england", label: "🇬🇧 بريطانيا" },
  { value: "usa", label: "🇺🇸 أمريكا" },
  { value: "brazil", label: "🇧🇷 البرازيل" },
  { value: "myanmar", label: "🇲🇲 ميانمار" },
  { value: "philippines", label: "🇵🇭 الفلبين" },
  { value: "malaysia", label: "🇲🇾 ماليزيا" },
  { value: "kenya", label: "🇰🇪 كينيا" },
  { value: "nigeria", label: "🇳🇬 نيجيريا" },
  { value: "southafrica", label: "🇿🇦 جنوب أفريقيا" },
  { value: "egypt", label: "🇪🇬 مصر" },
  { value: "morocco", label: "🇲🇦 المغرب" },
  { value: "iraq", label: "🇮🇶 العراق" },
  { value: "turkey", label: "🇹🇷 تركيا" },
  { value: "georgia", label: "🇬🇪 جورجيا" },
  { value: "bangladesh", label: "🇧🇩 بنغلاديش" },
];

async function call5sim(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke("fivesim", {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

async function callTelegramAuth(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke("telegram-auth", {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export function FiveSimPanel() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [priceInfo, setPriceInfo] = useState<{ Price: number; Qty: number } | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [orders, setOrders] = useState<OrderInfo[]>([]);
  const [buyingProgress, setBuyingProgress] = useState({ current: 0, total: 0, phase: "" });
  const apiId = "19757887";
  const apiHash = "e76390019d6fa291b1ca0f8b3d71d005";

  const fetchBalance = useCallback(async () => {
    try {
      const data = await call5sim("getBalance");
      setBalance(data.balance);
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    if (open) fetchBalance();
  }, [open, fetchBalance]);


  const fetchPrices = async (country: string) => {
    setLoadingPrices(true);
    setPriceInfo(null);
    try {
      const data = await call5sim("getPrices", { country });
      if (data && data.Price !== undefined) {
        setPriceInfo({ Price: data.Price, Qty: data.Qty || 0 });
      } else if (data && typeof data === "object") {
        const firstKey = Object.keys(data)[0];
        if (firstKey && data[firstKey]?.Price !== undefined) {
          setPriceInfo({ Price: data[firstKey].Price, Qty: data[firstKey].Qty || 0 });
        } else {
          setPriceInfo(null);
          toast({ title: "تنبيه", description: "لا تتوفر أرقام تيليجرام لهذه الدولة" });
        }
      }
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" });
    } finally {
      setLoadingPrices(false);
    }
  };

  const handleCountryChange = (value: string) => {
    setSelectedCountry(value);
    setQuantity(1);
    fetchPrices(value);
  };

  const totalPrice = priceInfo ? priceInfo.Price * quantity : 0;

  // Wait for SMS - returns all unique codes or null if timeout
  const waitForSms = async (orderId: number, maxAttempts = 24): Promise<string[] | null> => {
    // 24 attempts × 5s = 2 minutes max wait
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const data = await call5sim("checkOrder", { orderId });
        if (data.sms && data.sms.length > 0) {
          // Get unique codes, latest first
          const allCodes = data.sms.map((s: any) => String(s.code));
          const codes: string[] = Array.from(new Set<string>(allCodes)).reverse();
          return codes;
        }
        if (data.status === "CANCELED" || data.status === "TIMEOUT" || data.status === "BANNED") {
          return null;
        }
      } catch {
        // Continue polling
      }
    }
    return null;
  };

  const MAX_RETRIES = 5; // Max number of retries per account slot

  const buyAndRegisterOne = async (
    index: number,
    total: number,
    allOrders: OrderInfo[],
  ): Promise<void> => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const attemptLabel = attempt > 0 ? ` (محاولة ${attempt + 1})` : "";

      // Step 1: Buy number
      setBuyingProgress({
        current: index + 1,
        total,
        phase: `شراء رقم ${index + 1}${attemptLabel}...`,
      });

      let order5sim: any;
      try {
        order5sim = await call5sim("buyNumber", { country: selectedCountry });
      } catch (e: any) {
        // Can't buy → fail this slot
        const failOrder: OrderInfo = {
          id: Date.now(),
          phone: "---",
          status: "failed",
          price: 0,
          errorMessage: `فشل الشراء: ${e.message}`,
        };
        allOrders.push(failOrder);
        setOrders([...allOrders]);
        return;
      }

      const currentOrder: OrderInfo = {
        id: order5sim.id,
        phone: order5sim.phone,
        status: "waiting_sms",
        price: order5sim.price,
      };
      // Replace or add order in list
      const existingIdx = allOrders.findIndex((o) => o.phone === "---" && o.status === "failed");
      if (existingIdx >= 0) {
        allOrders[existingIdx] = currentOrder;
      } else {
        allOrders.push(currentOrder);
      }
      setOrders([...allOrders]);

      // Step 2: Send code to Telegram
      setBuyingProgress({
        current: index + 1,
        total,
        phase: `إرسال كود تيليجرام لـ ${currentOrder.phone}${attemptLabel}...`,
      });

      let sessionId: string | null = null;
      try {
        const sendResult = await callTelegramAuth("sendCode", {
          apiId,
          apiHash,
          phoneNumber: currentOrder.phone,
        });
        sessionId = sendResult.sessionId;
      } catch (e: any) {
        currentOrder.status = "failed";
        currentOrder.errorMessage = `فشل إرسال الكود: ${e.message}`;
        setOrders([...allOrders]);
        try { await call5sim("cancelOrder", { orderId: currentOrder.id }); } catch {}
        continue; // Retry with new number
      }

      // Step 3: Wait for SMS from 5sim
      setBuyingProgress({
        current: index + 1,
        total,
        phase: `انتظار كود SMS لـ ${currentOrder.phone}${attemptLabel}...`,
      });

      const codes = await waitForSms(currentOrder.id);
      if (!codes || codes.length === 0) {
        // No SMS = code went to Telegram app (number already registered)
        currentOrder.status = "failed";
        currentOrder.errorMessage = "الكود أُرسل لتطبيق تيليجرام - الرقم مسجل مسبقاً";
        setOrders([...allOrders]);
        try { await call5sim("cancelOrder", { orderId: currentOrder.id }); } catch {}
        toast({
          title: `رقم ${currentOrder.phone}`,
          description: "الكود ذهب للتطبيق وليس SMS. جاري شراء رقم جديد...",
        });
        continue; // Retry with new number
      }

      // SMS received! Try each code (latest first)
      currentOrder.smsCode = codes[0];
      currentOrder.status = "registering";
      setOrders([...allOrders]);

      setBuyingProgress({
        current: index + 1,
        total,
        phase: `تسجيل حساب ${currentOrder.phone}...`,
      });

      let verified = false;
      for (const code of codes) {
        try {
          const verifyResult = await callTelegramAuth("verifyCode", {
            sessionId,
            code,
          });
          if (verifyResult.success) {
            verified = true;
            currentOrder.smsCode = code;
            break;
          }
        } catch {
          // Try next code
        }
      }

      if (!verified) {
        currentOrder.status = "failed";
        currentOrder.errorMessage = "فشل التحقق من جميع الأكواد";
        setOrders([...allOrders]);
        try { await call5sim("finishOrder", { orderId: currentOrder.id }); } catch {}
        continue; // Retry with new number
      }

      // Step 4: Get session string
      try {
        const sessionResult = await callTelegramAuth("getSession", { sessionId });
        if (sessionResult.sessionString) {
          currentOrder.sessionString = sessionResult.sessionString;
          currentOrder.status = "got_session";
        } else {
          throw new Error("لم يتم استخراج الجلسة");
        }
        try { await call5sim("finishOrder", { orderId: currentOrder.id }); } catch {}
      } catch (e: any) {
        currentOrder.status = "failed";
        currentOrder.errorMessage = e.message;
        try { await call5sim("finishOrder", { orderId: currentOrder.id }); } catch {}
        continue; // Retry with new number
      }

      setOrders([...allOrders]);
      return; // Success!
    }

    // All retries exhausted
    toast({
      title: "تنبيه",
      description: `فشل الحساب ${index + 1} بعد ${MAX_RETRIES} محاولات`,
      variant: "destructive",
    });
  };

  const handleBuy = async () => {
    if (!selectedCountry || !priceInfo || quantity < 1) return;

    setLoading(true);
    setOrders([]);
    const allOrders: OrderInfo[] = [];

    try {
      for (let i = 0; i < quantity; i++) {
        await buyAndRegisterOne(i, quantity, allOrders);
      }

      setBuyingProgress({ current: 0, total: 0, phase: "" });
      fetchBalance();

      const successCount = allOrders.filter((o) => o.status === "got_session").length;
      toast({
        title: "اكتملت العملية",
        description: `تم إنشاء ${successCount} جلسة من ${quantity} مطلوب`,
      });
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSessions = () => {
    const successOrders = orders.filter((o) => o.status === "got_session" && o.sessionString);
    if (successOrders.length === 0) return;

    // Download each session as a separate file
    successOrders.forEach((order, idx) => {
      const blob = new Blob([order.sessionString!], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanPhone = order.phone.replace(/\+/g, "");
      a.download = `${cleanPhone}.session`;
      a.click();
      URL.revokeObjectURL(url);
    });

    toast({
      title: "تم التحميل",
      description: `تم تحميل ${successOrders.length} ملف جلسة`,
    });
  };

  const handleDownloadAllAsJson = () => {
    const successOrders = orders.filter((o) => o.status === "got_session" && o.sessionString);
    if (successOrders.length === 0) return;

    const data = successOrders.map((o) => ({
      phone: o.phone,
      sessionString: o.sessionString,
    }));

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sessions-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusLabel = (status: OrderInfo["status"]) => {
    switch (status) {
      case "buying": return "شراء...";
      case "waiting_sms": return "انتظار SMS";
      case "registering": return "تسجيل...";
      case "got_session": return "✓ جاهز";
      case "failed": return "✗ فشل";
      case "timeout": return "انتهت المهلة";
    }
  };

  const statusVariant = (status: OrderInfo["status"]) => {
    switch (status) {
      case "got_session": return "default" as const;
      case "failed":
      case "timeout": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  const progressPercent = buyingProgress.total > 0
    ? (buyingProgress.current / buyingProgress.total) * 100
    : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <ShoppingCart className="h-4 w-4" />
          شراء أرقام
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            شراء أرقام وتسجيل حسابات
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Balance */}
          <Card>
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">الرصيد:</span>
                {balance !== null ? (
                  <span className="text-sm font-bold">{balance.toFixed(2)} ₽</span>
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
              </div>
              <Button variant="ghost" size="icon" onClick={fetchBalance} className="h-8 w-8">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </CardContent>
          </Card>


          {/* Country Selection */}
          <div className="space-y-2">
            <Label>اختر الدولة</Label>
            <Select value={selectedCountry} onValueChange={handleCountryChange}>
              <SelectTrigger>
                <SelectValue placeholder="اختر دولة..." />
              </SelectTrigger>
              <SelectContent>
                {POPULAR_COUNTRIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Price Info */}
          {loadingPrices && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل الأسعار...
            </div>
          )}

          {priceInfo && (
            <Card>
              <CardContent className="p-3 space-y-3">
                <div className="flex justify-between text-sm">
                  <span>سعر الرقم الواحد:</span>
                  <span className="font-bold">{priceInfo.Price.toFixed(2)} ₽</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>الأرقام المتاحة:</span>
                  <span className="font-mono">{priceInfo.Qty}</span>
                </div>

                <div className="space-y-2">
                  <Label>عدد الحسابات</Label>
                  <Input
                    type="number"
                    min={1}
                    max={Math.min(priceInfo.Qty, 100)}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>

                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="font-bold">المجموع:</span>
                  <span className="text-lg font-bold">{totalPrice.toFixed(2)} ₽</span>
                </div>

                <Button
                  className="w-full"
                  onClick={handleBuy}
                  disabled={loading || quantity < 1 || (balance !== null && totalPrice > balance)}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin ml-2" />
                      جاري العمل...
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="h-4 w-4 ml-2" />
                      شراء وتسجيل {quantity} حساب
                    </>
                  )}
                </Button>

                {balance !== null && totalPrice > balance && (
                  <p className="text-xs text-destructive text-center">الرصيد غير كافٍ</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Progress */}
          {loading && buyingProgress.phase && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{buyingProgress.phase}</span>
                </div>
                <Progress value={progressPercent} className="h-2" />
                <div className="text-xs text-muted-foreground">
                  {buyingProgress.current} / {buyingProgress.total}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Orders List */}
          {orders.length > 0 && (
            <Card>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>
                    النتائج: {orders.filter((o) => o.status === "got_session").length} جلسة
                    من {orders.length}
                  </span>
                  {orders.some((o) => o.status === "got_session") && (
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={handleDownloadSessions} className="gap-1 h-7 text-xs">
                        <Download className="h-3 w-3" />
                        .session
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDownloadAllAsJson} className="gap-1 h-7 text-xs">
                        <Download className="h-3 w-3" />
                        JSON
                      </Button>
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <ScrollArea className="max-h-48">
                  <div className="space-y-1">
                    {orders.map((order) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between text-xs p-2 rounded bg-muted/50"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono">{order.phone}</span>
                          {order.errorMessage && (
                            <span className="text-destructive text-[10px]">{order.errorMessage}</span>
                          )}
                        </div>
                        <Badge variant={statusVariant(order.status)}>
                          {statusLabel(order.status)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
