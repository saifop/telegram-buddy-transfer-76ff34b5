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
  const [apiId, setApiId] = useState(() => localStorage.getItem("5sim_api_id") || "");
  const [apiHash, setApiHash] = useState(() => localStorage.getItem("5sim_api_hash") || "");

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

  // Save API credentials to localStorage
  useEffect(() => {
    if (apiId) localStorage.setItem("5sim_api_id", apiId);
    if (apiHash) localStorage.setItem("5sim_api_hash", apiHash);
  }, [apiId, apiHash]);

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

  const waitForSms = async (orderId: number, maxAttempts = 60): Promise<string | null> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const data = await call5sim("checkOrder", { orderId });
        if (data.sms && data.sms.length > 0) {
          return data.sms[0].code;
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

  const registerTelegramAccount = async (
    phone: string,
    smsCode: string,
  ): Promise<string | null> => {
    try {
      // Step 1: Send code to Telegram
      const sendResult = await callTelegramAuth("sendCode", {
        apiId,
        apiHash,
        phoneNumber: phone,
      });

      if (!sendResult.success) {
        throw new Error(sendResult.message || "فشل إرسال الكود");
      }

      const sessionId = sendResult.sessionId;

      // Step 2: Verify with SMS code from 5sim
      const verifyResult = await callTelegramAuth("verifyCode", {
        sessionId,
        code: smsCode,
      });

      if (!verifyResult.success) {
        throw new Error(verifyResult.message || "فشل التحقق من الكود");
      }

      // Step 3: Get session string
      const sessionResult = await callTelegramAuth("getSession", {
        sessionId,
      });

      if (!sessionResult.success || !sessionResult.sessionString) {
        throw new Error("فشل استخراج الجلسة");
      }

      return sessionResult.sessionString;
    } catch (e: any) {
      console.error("Registration error:", e);
      throw e;
    }
  };

  const handleBuy = async () => {
    if (!selectedCountry || !priceInfo || quantity < 1) return;

    if (!apiId || !apiHash) {
      toast({
        title: "مطلوب",
        description: "أدخل API ID و API Hash أولاً",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setOrders([]);
    const newOrders: OrderInfo[] = [];

    try {
      // Phase 1: Buy all numbers
      for (let i = 0; i < quantity; i++) {
        setBuyingProgress({
          current: i + 1,
          total: quantity,
          phase: `شراء رقم ${i + 1} من ${quantity}...`,
        });

        try {
          const order = await call5sim("buyNumber", { country: selectedCountry });
          newOrders.push({
            id: order.id,
            phone: order.phone,
            status: "waiting_sms",
            price: order.price,
          });
          setOrders([...newOrders]);
        } catch (e: any) {
          toast({
            title: `فشل شراء الرقم ${i + 1}`,
            description: e.message,
            variant: "destructive",
          });
          break;
        }
      }

      // Phase 2: For each number - wait for SMS then register
      for (let i = 0; i < newOrders.length; i++) {
        const order = newOrders[i];

        // 2a: Send code to Telegram first
        setBuyingProgress({
          current: i + 1,
          total: newOrders.length,
          phase: `إرسال كود تيليجرام لـ ${order.phone}...`,
        });

        let sessionId: string | null = null;
        try {
          const sendResult = await callTelegramAuth("sendCode", {
            apiId,
            apiHash,
            phoneNumber: order.phone,
          });
          sessionId = sendResult.sessionId;
        } catch (e: any) {
          order.status = "failed";
          order.errorMessage = `فشل إرسال الكود: ${e.message}`;
          setOrders([...newOrders]);
          try { await call5sim("cancelOrder", { orderId: order.id }); } catch {}
          continue;
        }

        // 2b: Wait for SMS from 5sim
        setBuyingProgress({
          current: i + 1,
          total: newOrders.length,
          phase: `انتظار كود SMS لـ ${order.phone}...`,
        });

        const code = await waitForSms(order.id);
        if (!code) {
          order.status = "timeout";
          order.errorMessage = "لم يصل كود SMS";
          setOrders([...newOrders]);
          try { await call5sim("cancelOrder", { orderId: order.id }); } catch {}
          continue;
        }

        order.smsCode = code;
        order.status = "registering";
        setOrders([...newOrders]);

        // 2c: Verify code with Telegram
        setBuyingProgress({
          current: i + 1,
          total: newOrders.length,
          phase: `تسجيل حساب ${order.phone}...`,
        });

        try {
          const verifyResult = await callTelegramAuth("verifyCode", {
            sessionId,
            code,
          });

          if (!verifyResult.success) {
            throw new Error(verifyResult.message || "فشل التحقق");
          }

          // 2d: Get session string
          const sessionResult = await callTelegramAuth("getSession", { sessionId });

          if (sessionResult.sessionString) {
            order.sessionString = sessionResult.sessionString;
            order.status = "got_session";
          } else {
            throw new Error("لم يتم استخراج الجلسة");
          }

          try { await call5sim("finishOrder", { orderId: order.id }); } catch {}
        } catch (e: any) {
          order.status = "failed";
          order.errorMessage = e.message;
          try { await call5sim("finishOrder", { orderId: order.id }); } catch {}
        }

        setOrders([...newOrders]);
      }

      setBuyingProgress({ current: 0, total: 0, phase: "" });
      fetchBalance();

      const successCount = newOrders.filter((o) => o.status === "got_session").length;
      toast({
        title: "اكتملت العملية",
        description: `تم إنشاء ${successCount} جلسة من ${newOrders.length} رقم`,
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

          {/* Telegram API Credentials */}
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <Key className="h-4 w-4" />
                بيانات Telegram API
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">API ID</Label>
                  <Input
                    value={apiId}
                    onChange={(e) => setApiId(e.target.value)}
                    placeholder="مثال: 12345678"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">API Hash</Label>
                  <Input
                    value={apiHash}
                    onChange={(e) => setApiHash(e.target.value)}
                    placeholder="32 حرف"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                احصل عليهم من{" "}
                <a href="https://my.telegram.org" target="_blank" rel="noopener" className="underline">
                  my.telegram.org
                </a>
              </p>
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
                  disabled={loading || quantity < 1 || !apiId || !apiHash || (balance !== null && totalPrice > balance)}
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
                {(!apiId || !apiHash) && (
                  <p className="text-xs text-destructive text-center">أدخل API ID و API Hash أولاً</p>
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
