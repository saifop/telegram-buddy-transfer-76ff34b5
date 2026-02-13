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
import { ShoppingCart, Loader2, Wallet, Phone, Download, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface OrderInfo {
  id: number;
  phone: string;
  status: string;
  smsCode?: string;
  price: number;
}

// Popular countries for Telegram
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

  const fetchBalance = useCallback(async () => {
    try {
      const data = await call5sim("getBalance");
      setBalance(data.balance);
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      fetchBalance();
    }
  }, [open, fetchBalance]);

  const fetchPrices = async (country: string) => {
    setLoadingPrices(true);
    setPriceInfo(null);
    try {
      const data = await call5sim("getPrices", { country });
      if (data && data.Price !== undefined) {
        setPriceInfo({ Price: data.Price, Qty: data.Qty || 0 });
      } else if (data && typeof data === "object") {
        // Try to extract from nested structure
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

  const totalPrice = priceInfo ? (priceInfo.Price * quantity) : 0;

  const waitForSms = async (orderId: number, maxAttempts = 60): Promise<string | null> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5000)); // Wait 5 seconds
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

  const handleBuy = async () => {
    if (!selectedCountry || !priceInfo || quantity < 1) return;

    setLoading(true);
    setOrders([]);
    setBuyingProgress({ current: 0, total: quantity, phase: "شراء الأرقام..." });

    const newOrders: OrderInfo[] = [];

    try {
      for (let i = 0; i < quantity; i++) {
        setBuyingProgress({ current: i + 1, total: quantity, phase: `شراء رقم ${i + 1} من ${quantity}...` });

        try {
          const order = await call5sim("buyNumber", { country: selectedCountry });
          const orderInfo: OrderInfo = {
            id: order.id,
            phone: order.phone,
            status: "waiting",
            price: order.price,
          };
          newOrders.push(orderInfo);
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

      // Now wait for SMS codes
      for (let i = 0; i < newOrders.length; i++) {
        const order = newOrders[i];
        setBuyingProgress({
          current: i + 1,
          total: newOrders.length,
          phase: `انتظار كود التفعيل لـ ${order.phone}...`,
        });

        const code = await waitForSms(order.id);
        if (code) {
          order.smsCode = code;
          order.status = "received";
          // Finish the order
          try {
            await call5sim("finishOrder", { orderId: order.id });
          } catch {
            // ok
          }
        } else {
          order.status = "timeout";
          // Cancel the order
          try {
            await call5sim("cancelOrder", { orderId: order.id });
          } catch {
            // ok
          }
        }
        setOrders([...newOrders]);
      }

      setBuyingProgress({ current: 0, total: 0, phase: "" });
      fetchBalance();

      const successCount = newOrders.filter((o) => o.status === "received").length;
      toast({
        title: "اكتملت العملية",
        description: `تم استلام ${successCount} كود من ${newOrders.length} رقم`,
      });
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCodes = () => {
    const successOrders = orders.filter((o) => o.status === "received" && o.smsCode);
    if (successOrders.length === 0) return;

    const content = successOrders
      .map((o) => `${o.phone} | ${o.smsCode}`)
      .join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `5sim-codes-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <ShoppingCart className="h-4 w-4" />
          شراء أرقام
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            لوحة شراء الأرقام - 5sim
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
                  <Badge variant="secondary">{balance.toFixed(2)} ₽</Badge>
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
                  <Badge>{priceInfo.Price.toFixed(2)} ₽</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span>الأرقام المتاحة:</span>
                  <Badge variant="outline">{priceInfo.Qty}</Badge>
                </div>

                {/* Quantity */}
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

                {/* Total */}
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="font-bold">المجموع:</span>
                  <Badge variant="default" className="text-base px-3 py-1">
                    {totalPrice.toFixed(2)} ₽
                  </Badge>
                </div>

                <Button
                  className="w-full"
                  onClick={handleBuy}
                  disabled={loading || quantity < 1 || (balance !== null && totalPrice > balance)}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin ml-2" />
                      {buyingProgress.phase}
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="h-4 w-4 ml-2" />
                      شراء {quantity} رقم
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
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{buyingProgress.phase}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
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
                  <span>النتائج ({orders.filter((o) => o.status === "received").length}/{orders.length})</span>
                  {orders.some((o) => o.status === "received") && (
                    <Button variant="outline" size="sm" onClick={handleDownloadCodes} className="gap-1 h-7 text-xs">
                      <Download className="h-3 w-3" />
                      تحميل الأكواد
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <ScrollArea className="max-h-40">
                  <div className="space-y-1">
                    {orders.map((order) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between text-xs p-2 rounded bg-muted/50"
                      >
                        <span className="font-mono">{order.phone}</span>
                        <div className="flex items-center gap-2">
                          {order.smsCode && (
                            <Badge variant="secondary" className="font-mono">
                              {order.smsCode}
                            </Badge>
                          )}
                          <Badge
                            variant={
                              order.status === "received"
                                ? "default"
                                : order.status === "timeout"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {order.status === "received"
                              ? "✓ تم"
                              : order.status === "timeout"
                              ? "انتهت المهلة"
                              : "انتظار..."}
                          </Badge>
                        </div>
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
