import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIVESIM_BASE = 'https://5sim.net/v1';

function getHeaders() {
  const apiKey = Deno.env.get('FIVESIM_API_KEY');
  if (!apiKey) throw new Error('FIVESIM_API_KEY not configured');
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
  };
}

async function getBalance() {
  const res = await fetch(`${FIVESIM_BASE}/user/profile`, { headers: getHeaders() });
  const data = await res.json();
  return { balance: data.balance, currency: data.default_country?.currency || 'RUB' };
}

async function getPrices(country: string) {
  const res = await fetch(`${FIVESIM_BASE}/guest/prices?product=telegram&country=${country}`, {
    headers: { 'Accept': 'application/json' },
  });
  const data = await res.json();
  return data;
}

async function getCountries() {
  const res = await fetch(`${FIVESIM_BASE}/guest/countries`, {
    headers: { 'Accept': 'application/json' },
  });
  const data = await res.json();
  return data;
}

async function getProductPrices(country: string) {
  const res = await fetch(`${FIVESIM_BASE}/guest/products/${country}/any`, {
    headers: { 'Accept': 'application/json' },
  });
  const data = await res.json();
  // Return telegram product info
  if (data.telegram) {
    return data.telegram;
  }
  return null;
}

async function buyNumber(country: string) {
  const res = await fetch(`${FIVESIM_BASE}/user/buy/activation/${country}/any/telegram`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Buy failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data; // { id, phone, operator, product, price, status, ... }
}

async function checkOrder(orderId: number) {
  const res = await fetch(`${FIVESIM_BASE}/user/check/${orderId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Check failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data; // { id, phone, sms: [{code, ...}], status, ... }
}

async function cancelOrder(orderId: number) {
  const res = await fetch(`${FIVESIM_BASE}/user/cancel/${orderId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cancel failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data;
}

async function finishOrder(orderId: number) {
  const res = await fetch(`${FIVESIM_BASE}/user/finish/${orderId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Finish failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: any = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // No body or invalid JSON - use empty object
    }

    const { action, country, orderId } = body;

    if (!action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let result: any;

    switch (action) {
      case 'getBalance':
        result = await getBalance();
        break;
      case 'getCountries':
        result = await getCountries();
        break;
      case 'getPrices':
        if (!country) throw new Error('country is required');
        result = await getProductPrices(country);
        break;
      case 'buyNumber':
        if (!country) throw new Error('country is required');
        result = await buyNumber(country);
        break;
      case 'checkOrder':
        if (!orderId) throw new Error('orderId is required');
        result = await checkOrder(orderId);
        break;
      case 'cancelOrder':
        if (!orderId) throw new Error('orderId is required');
        result = await cancelOrder(orderId);
        break;
      case 'finishOrder':
        if (!orderId) throw new Error('orderId is required');
        result = await finishOrder(orderId);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('5sim error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
